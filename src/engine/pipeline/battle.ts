import type { GameData } from '../../data/schema.js';
import {
  DEFAULT_CONFIG, type Action, type BattleConfig, type BattleState, type Combatant, type Declarations, type Position,
  type SideIndex, type SideState,
} from '../model/battle.js';
import type { SideSetup } from '../model/types.js';
import { emit } from '../log/events.js';
import { createRng } from '../rng.js';
import { RULE_GAPS } from '../gaps.js';
import { dodgeChance } from '../rules/accuracy.js';
import { techniqueAvailability } from '../effects/availability.js';
import { hasErrors, positionCapacityAtDeployment, validatePreparation, type Violation } from '../legality/preparation.js';
import { positionsNeedingDeclaration, validateDeclaration } from '../legality/actions.js';
import { combatant, findPosition, orderDesc, positionId, roll, sideOf, type Controllers, type EngineCtx } from './context.js';
import { createCombatant, effSpeed, isViableReserve, restrictionActive } from './combatant.js';
import { exitField, forcedReplacement, initialDeployment, materializeWithEntry } from './lifecycle.js';
import { executeTechnique } from './techniques.js';

export class PreparationError extends Error {
  constructor(public readonly violations: { side: SideIndex; violations: Violation[] }[]) {
    super(`Preparacion invalida: ${violations.flatMap((v) => v.violations.filter((x) => x.severity === 'error').map((x) => `[S${v.side}] ${x.code} ${x.message}`)).join('; ')}`);
  }
}

export class DeclarationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Declaracion invalida: ${problems.join('; ')}`);
  }
}

export interface CreateBattleOptions {
  seed: number;
  config?: Partial<BattleConfig>;
  controllers?: Controllers;
}

export function createBattle(data: GameData, setups: [SideSetup, SideSetup], opts: CreateBattleOptions): BattleState {
  const violations = setups.map((s, i) => ({ side: i as SideIndex, violations: validatePreparation(s, data) }));
  if (violations.some((v) => hasErrors(v.violations))) throw new PreparationError(violations);

  const config: BattleConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const sides = setups.map((s, i): SideState => {
    const side = i as SideIndex;
    const positions: Position[] = [];
    for (let slot = 0; slot < positionCapacityAtDeployment(s); slot++) {
      positions.push({ id: positionId(side, slot), side, slot, temporary: false, openedRound: 0, occupantUid: null, partialUid: null });
    }
    return { index: side, summoner: s.summoner, combatants: s.preparation.creatures.map((c) => createCombatant(side, c)), positions, sideEffects: [], surrendered: false };
  }) as [SideState, SideState];

  const st: BattleState = { config, round: 0, phase: 'deployment', sides, environment: null, rng: createRng(opts.seed), log: [], nextEventId: 1, outcome: null };
  emit(st, {
    type: 'battle_start',
    data: {
      seed: opts.seed,
      config,
      assumptions: RULE_GAPS.map((g) => ({ id: g.id, assumption: g.assumption })),
      warnings: violations.flatMap((v) => v.violations.filter((x) => x.severity === 'warning').map((x) => `[S${v.side}] ${x.code} ${x.message}`)),
    },
  });

  const ctx: EngineCtx = { data, st, controllers: opts.controllers ?? {} };
  const placements: { c: Combatant; pos: Position }[] = [];
  setups.forEach((s, i) => {
    const side = sides[i]!;
    s.initialDeployment.forEach((cid, slot) => {
      const pos = side.positions[slot];
      if (cid === null || !pos) return;
      const c = side.combatants.find((x) => x.creature.id === cid)!;
      if (isViableReserve(c)) placements.push({ c, pos });
    });
  });
  initialDeployment(ctx, placements);
  checkOutcome(ctx);
  return st;
}

export interface RoundStartChoice {
  side: SideIndex;
  creatureId: string;
  positionId?: string;
}

// CANON-MECHANICS 28.2.1-2 / 13.2
export function beginRound(data: GameData, state: BattleState, choices: RoundStartChoice[] = [], controllers: Controllers = {}): BattleState {
  if (state.outcome) throw new Error('el combate ha terminado');
  if (state.phase !== 'deployment' && state.phase !== 'close') throw new Error(`beginRound en fase ${state.phase}`);
  const st = structuredClone(state);
  const ctx: EngineCtx = { data, st, controllers };
  st.round++;
  st.phase = 'round_start';
  emit(st, { type: 'round_start', ruleRef: 'CANON-MECHANICS 28.2' });

  const problems: string[] = [];
  const pending: { c: Combatant; pos: Position; opened: boolean }[] = [];
  for (const ch of choices) {
    const side = sideOf(st, ch.side);
    const c = side.combatants.find((x) => x.creature.id === ch.creatureId);
    if (!c || !isViableReserve(c) || pending.some((p) => p.c === c)) {
      problems.push(`S${ch.side}: ${ch.creatureId} no es una reserva viable`);
      continue;
    }
    if (ch.positionId !== undefined) {
      const pos = side.positions.find((p) => p.id === ch.positionId);
      if (!pos || pos.occupantUid !== null || pending.some((p) => p.pos === pos)) problems.push(`S${ch.side}: ${ch.positionId} no es una posicion vacia propia`);
      else pending.push({ c, pos, opened: false });
      continue;
    }
    if (side.summoner.simultaneity !== 'adept_temporary' || side.positions.length >= 2 || pending.some((p) => p.opened && p.pos.side === ch.side)) {
      problems.push(`S${ch.side}: no puede abrir una segunda posicion temporal`);
      continue;
    }
    const slot = 1;
    pending.push({ c, pos: { id: positionId(ch.side, slot), side: ch.side, slot, temporary: true, openedRound: st.round, occupantUid: null, partialUid: null }, opened: true });
  }
  if (problems.length > 0) throw new DeclarationError(problems);

  const ordered = orderDesc(ctx, pending, (p) => [effSpeed(data, p.c)], 'round_start_materialization', (p) => p.c.uid);
  for (const p of ordered) {
    if (p.opened) {
      sideOf(st, p.pos.side).positions.push(p.pos);
      emit(st, { type: 'position_opened', targets: [p.pos.id], ruleRef: 'CANON-MECHANICS 13.2' });
    } else {
      emit(st, { type: 'rule_gap', targets: [p.pos.id], data: { gap: 'GAP-EMPTY-POSITION-FILL' } });
    }
    materializeWithEntry(ctx, p.c, p.pos);
  }

  for (const side of st.sides) for (const c of side.combatants) {
    c.presentAtDeclaration = c.location === 'field';
    c.dodgingThisRound = false;
    c.actedThisRound = false;
    c.flinched = false;
  }
  st.phase = 'declaration';
  return st;
}

interface Frozen {
  positionId: string;
  side: SideIndex;
  actorUid: string;
  action: Action;
}

function freeze(ctx: EngineCtx, decls: Declarations): Frozen[] {
  const problems: string[] = [];
  const out: Frozen[] = [];
  for (const p of positionsNeedingDeclaration(ctx.st)) if (!decls[p.id]) problems.push(`${p.id}: falta declaracion`);
  for (const [pid, action] of Object.entries(decls)) {
    const pos = findPosition(ctx.st, pid);
    if (!pos) {
      problems.push(`${pid}: posicion inexistente`);
      continue;
    }
    const err = validateDeclaration(ctx, pid, action);
    if (err) {
      problems.push(`${pid}: ${err}`);
      continue;
    }
    const actorUid = action.kind === 'partial' ? `${pos.side}:${action.creatureId}` : pos.occupantUid!;
    out.push({ positionId: pid, side: pos.side, actorUid, action });
  }
  if (problems.length > 0) throw new DeclarationError(problems);
  return out;
}

function fail(ctx: EngineCtx, f: Frozen, reason: string, ruleRef: string): void {
  combatant(ctx.st, f.actorUid).actedThisRound = true;
  emit(ctx.st, { type: 'action_failed', actor: f.actorUid, targets: [f.positionId], data: { action: f.action.kind, reason }, ruleRef });
}

function stillOccupies(ctx: EngineCtx, f: Frozen): Combatant | null {
  const c = combatant(ctx.st, f.actorUid);
  return c.location === 'field' && c.positionId === f.positionId ? c : null;
}

// CANON-MECHANICS 16.3 / 28.3
function resolveSwitch(ctx: EngineCtx, f: Frozen): void {
  if (f.action.kind !== 'switch') return;
  const out = stillOccupies(ctx, f);
  if (!out) return fail(ctx, f, 'la criatura saliente ya no ocupa la posicion', 'CANON-MECHANICS 14.3');
  const rooted = restrictionActive(out, 'no_voluntary_withdraw');
  if (rooted) return fail(ctx, f, `${rooted}: la Retirada voluntaria se ha vuelto ilegal`, 'CANON-MECHANICS 16.4 / 24.5');
  const incoming = sideOf(ctx.st, f.side).combatants.find((c) => c.creature.id === (f.action as { incomingId: string }).incomingId);
  if (!incoming || !isViableReserve(incoming)) return fail(ctx, f, 'el reemplazo ya no es viable', 'CANON-MECHANICS 16.4');
  const pos = findPosition(ctx.st, f.positionId)!;
  out.actedThisRound = true;
  const ev = emit(ctx.st, { type: 'switch', actor: out.uid, targets: [pos.id], data: { incoming: incoming.uid }, ruleRef: 'CANON-MECHANICS 16.3' });
  exitField(ctx, out, 'withdraw', ev);
  materializeWithEntry(ctx, incoming, pos, ev);
}

// CANON-MECHANICS 17 / 28.4
function resolveDodge(ctx: EngineCtx, f: Frozen): void {
  const c = stillOccupies(ctx, f);
  if (!c) return fail(ctx, f, 'la criatura ya no ocupa la posicion', 'CANON-MECHANICS 14.3');
  const chance = dodgeChance(c.dodgeStreak);
  const r = roll(ctx, `dodge:${c.uid}`, chance);
  c.actedThisRound = true;
  c.dodgeStreak++;
  c.dodgingThisRound = r.result;
  c.lastTurnTechniqueId = null;
  emit(ctx.st, { type: r.result ? 'dodge_success' : 'dodge_fail', actor: c.uid, data: { consecutiveUse: c.dodgeStreak, chance }, rolls: [r], ruleRef: 'CANON-MECHANICS 17' });
}

// CANON-MECHANICS 28.5.15
function resolveAction(ctx: EngineCtx, f: Frozen): void {
  const a = f.action;
  if (a.kind === 'partial') {
    const pos = findPosition(ctx.st, f.positionId);
    const c = combatant(ctx.st, f.actorUid);
    const t = ctx.data.techniques.get(a.techniqueId)!;
    if (!pos || pos.occupantUid !== null || !isViableReserve(c)) return fail(ctx, f, 'la Materializacion parcial ya no es posible', 'CANON-MECHANICS 14.3');
    c.actedThisRound = true;
    pos.partialUid = c.uid;
    const ev = emit(ctx.st, { type: 'partial_materialization', actor: c.uid, targets: [pos.id], data: { technique: t.id }, ruleRef: 'CANON-MECHANICS 1 (Materializacion parcial) / 32' });
    executeTechnique(ctx, t, c, a.target, ev, true);
    pos.partialUid = null;
    emit(ctx.st, { type: 'partial_end', actor: c.uid, targets: [pos.id], cause: ev, ruleRef: 'CANON-MECHANICS 32' });
    return;
  }
  if (a.kind !== 'technique') return;
  const c = stillOccupies(ctx, f);
  if (!c) return fail(ctx, f, 'el usuario ya no esta activo; la accion se pierde', 'CANON-MECHANICS 16.6 / 28.5.15');
  if (c.flinched) return fail(ctx, f, 'retrocede y no puede actuar este turno', 'CANON-TECHNIQUES / GAP-FLINCH');
  c.actedThisRound = true;
  c.dodgeStreak = 0;
  const t = ctx.data.techniques.get(a.techniqueId)!;
  const continuing = c.charging?.techniqueId === t.id;
  if (!continuing) {
    const avail = techniqueAvailability(t, ctx.st.config.effectsMode);
    if (!avail.executable) return fail(ctx, f, avail.reason ?? 'tecnica no ejecutable', 'CANON-MECHANICS 14.3');
    const dis = restrictionActive(c, 'no_same_technique_consecutive');
    if (dis && c.lastTurnTechniqueId === t.id) return fail(ctx, f, `${dis}: tecnica repetida`, 'CANON-MECHANICS 14.3 / 24.8');
  }
  c.lastTurnTechniqueId = t.id;
  if (t.override?.charge && !continuing) {
    c.charging = { techniqueId: t.id, target: a.target };
    emit(ctx.st, { type: 'charge_start', actor: c.uid, data: { technique: t.id }, ruleRef: 'CANON-MECHANICS 19.5' });
    return;
  }
  const target = continuing ? c.charging!.target : a.target;
  c.charging = null;
  const ev = emit(ctx.st, { type: 'technique', actor: c.uid, targets: target.kind === 'position' ? [target.positionId] : [], data: { technique: t.id, priority: t.priority }, ruleRef: 'CANON-MECHANICS 18' });
  executeTechnique(ctx, t, c, target, ev);
}

function hadTurn(c: Combatant): boolean {
  return c.presentAtDeclaration && c.location === 'field';
}

// CANON-MECHANICS 28.6
function closeRound(ctx: EngineCtx, surrendered: Set<SideIndex>): void {
  const st = ctx.st;
  st.phase = 'close';
  const turnHolders = orderDesc(ctx, st.sides.flatMap((s) => s.combatants).filter(hadTurn), (c) => [effSpeed(ctx.data, c)], 'end_of_turn', (c) => c.uid);
  for (const c of turnHolders) {
    for (const s of c.statuses) {
      const dot = ctx.data.statuses.get(s.id)?.damageOverTime;
      if (!dot || c.location !== 'field') continue;
      const loss = Math.min(c.hp, Math.max(0, Math.round((c.maxHp * dot.pctMaxHp) / 100)));
      const before = c.hp;
      c.hp -= loss;
      const ev = emit(st, { type: 'status_damage', actor: c.uid, data: { status: s.id, loss, before, after: c.hp, gap: 'GAP-DOT-ROUNDING' }, ruleRef: `CANON-MECHANICS ${ctx.data.statuses.get(s.id)?.section ?? '24'}` });
      if (c.hp <= 0) {
        const pid = c.positionId!;
        exitField(ctx, c, 'defeat', ev);
        forcedReplacement(ctx, pid, ev);
      }
    }
  }
  emit(st, { type: 'end_of_round', ruleRef: 'CANON-MECHANICS 28.6.17' });

  for (const c of turnHolders) {
    if (!hadTurn(c)) continue;
    c.turnsMaterialized++;
    c.turnsSinceEntry++;
    for (const s of c.statuses) for (const k of Object.keys(s.counters)) if ((s.counters[k] ?? 0) > 0) s.counters[k]!--;
  }
  emit(st, { type: 'counters_advanced', data: { creatures: turnHolders.filter(hadTurn).map((c) => c.uid), gap: 'GAP-TURN-PREDICATE' }, ruleRef: 'CANON-MECHANICS 24.2 / 28.6.18' });
  for (const side of st.sides) {
    side.sideEffects = side.sideEffects.map((e) => ({ ...e, roundsLeft: e.roundsLeft - 1 })).filter((e) => e.roundsLeft > 0);
  }

  for (const side of st.sides) {
    for (const pos of side.positions.filter((p) => p.temporary)) {
      const sustain = side.summoner.adeptSustain;
      const maxRounds = sustain?.maxRounds ?? (sustain?.chancePct === undefined ? 1 : Infinity);
      const open = st.round - pos.openedRound + 1;
      let kept = open < maxRounds;
      const rolls = [];
      if (kept && sustain?.chancePct !== undefined) {
        const r = roll(ctx, `adept_sustain:${pos.id}`, sustain.chancePct);
        rolls.push(r);
        kept = r.result;
      }
      const ev = emit(st, { type: kept ? 'position_sustained' : 'position_closed', targets: [pos.id], data: { roundsOpen: open, gap: 'GAP-ADEPT-SUSTAIN' }, rolls, ruleRef: 'CANON-MECHANICS 13.2 / 28.6.19' });
      if (!kept) {
        if (pos.occupantUid) exitField(ctx, combatant(st, pos.occupantUid), 'position_closed', ev);
        side.positions = side.positions.filter((p) => p !== pos);
      }
    }
  }

  for (const i of surrendered) st.sides[i].surrendered = true;
  for (const side of st.sides) for (const c of side.combatants) {
    c.presentAtDeclaration = false;
    c.dodgingThisRound = false;
    c.actedThisRound = false;
    c.flinched = false;
  }
  checkOutcome(ctx);
}

function checkOutcome(ctx: EngineCtx): void {
  const st = ctx.st;
  const lost = st.sides.map((s) => s.surrendered || s.combatants.every((c) => c.location === 'defeated'));
  if (lost[0] && lost[1]) st.outcome = { kind: 'draw', reason: 'ambos invocadores derrotados o rendidos (GAP-DOUBLE-KO)' };
  else if (lost[0] || lost[1]) {
    const loser = lost[0] ? 0 : 1;
    const reason = st.sides[loser].surrendered ? 'rendicion' : 'todas las criaturas de la Preparacion derrotadas (26.2)';
    st.outcome = { kind: 'victory', winner: loser === 0 ? 1 : 0, reason };
  } else if (st.round >= st.config.maxRounds) {
    st.outcome = { kind: 'draw', reason: 'limite de rondas (GAP-ROUND-CAP)' };
  }
  if (st.outcome) {
    st.phase = 'ended';
    emit(st, { type: 'battle_end', data: { outcome: st.outcome }, ruleRef: 'CANON-MECHANICS 26.2' });
  }
}

// CANON-MECHANICS 28.3-28.6
export function resolveRound(data: GameData, state: BattleState, declarations: Declarations, controllers: Controllers = {}): BattleState {
  if (state.phase !== 'declaration') throw new Error(`resolveRound en fase ${state.phase}`);
  const st = structuredClone(state);
  const ctx: EngineCtx = { data, st, controllers };
  const frozen = freeze(ctx, declarations);
  for (const f of frozen) emit(st, { type: 'declaration', actor: f.actorUid, targets: [f.positionId], data: { action: f.action }, ruleRef: 'CANON-MECHANICS 14.1' });

  st.phase = 'switches';
  const switches = frozen.filter((f) => f.action.kind === 'switch');
  for (const f of orderDesc(ctx, switches, (x) => [effSpeed(data, combatant(st, x.actorUid))], 'switch_order', (x) => x.actorUid)) resolveSwitch(ctx, f);

  st.phase = 'dodges';
  for (const f of frozen.filter((x) => x.action.kind === 'dodge')) resolveDodge(ctx, f);

  st.phase = 'actions';
  const acts = frozen.filter((f) => f.action.kind === 'technique' || f.action.kind === 'partial');
  const key = (f: Frozen) => {
    const a = f.action as { techniqueId: string };
    return [data.techniques.get(a.techniqueId)?.priority ?? 0, effSpeed(data, combatant(st, f.actorUid))];
  };
  const ordered = orderDesc(ctx, acts, key, 'action_order', (x) => x.actorUid);
  emit(st, { type: 'action_order', data: { order: ordered.map((f) => f.actorUid), gap: 'GAP-ORDER-STATIC' }, ruleRef: 'CANON-MECHANICS 28.5.12-14' });
  for (const f of ordered) resolveAction(ctx, f);

  closeRound(ctx, new Set(frozen.filter((f) => f.action.kind === 'surrender').map((f) => f.side)));
  return st;
}
