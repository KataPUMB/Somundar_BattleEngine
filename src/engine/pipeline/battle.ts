import type { GameData, Technique } from '../../data/schema.js';
import {
  DEFAULT_CONFIG, type Action, type BattleConfig, type BattleState, type Combatant, type Declarations, type Position,
  type SideIndex, type SideState,
} from '../model/battle.js';
import type { SideSetupInput, StageKey } from '../model/types.js';
import { emit } from '../log/events.js';
import { createRng } from '../rng.js';
import { RULE_GAPS } from '../gaps.js';
import { dodgeChance } from '../rules/accuracy.js';
import { clampStage } from '../rules/stats.js';
import { hasErrors, positionCapacityAtDeployment, validatePreparation, type Violation } from '../legality/preparation.js';
import { resolveSetup } from '../legality/species.js';
import { positionsNeedingDeclaration, techniqueBlockReason, validateDeclaration } from '../legality/actions.js';
import { afterHpLoss, auraOps, heal, loseHp, marksOf, removeMark, speedOf } from '../effects/runtime.js';
import { runAuras } from '../effects/interpreter.js';
import { combatant, findPosition, orderDesc, positionId, roll, sideOf, type Controllers, type EngineCtx } from './context.js';
import { createCombatant, isViableReserve } from './combatant.js';
import { exitField, initialDeployment, materializeWithEntry, withdrawBlocker } from './lifecycle.js';
import { defeatIfZero, executeTechnique, flushPending } from './techniques.js';
import { techniquePassiveOps } from './damage.js';

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

export function createBattle(data: GameData, inputs: [SideSetupInput, SideSetupInput], opts: CreateBattleOptions): BattleState {
  const violations = inputs.map((s, i) => ({ side: i as SideIndex, violations: validatePreparation(s, data) }));
  if (violations.some((v) => hasErrors(v.violations))) throw new PreparationError(violations);
  const setups = inputs.map((s) => resolveSetup(s, data));

  const config: BattleConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const sides = setups.map((s, i): SideState => {
    const side = i as SideIndex;
    const positions: Position[] = [];
    for (let slot = 0; slot < positionCapacityAtDeployment(s); slot++) {
      positions.push({ id: positionId(side, slot), side, slot, temporary: false, openedRound: 0, occupantUid: null, partialUid: null });
    }
    return { index: side, summoner: s.summoner, combatants: s.preparation.creatures.map((c) => createCombatant(side, c, data.species.get(c.speciesId)?.name)), positions, sideEffects: [], surrendered: false };
  }) as [SideState, SideState];

  const st: BattleState = {
    config, round: 0, phase: 'deployment', sides, environment: null, field: { trickRoomRounds: 0, priorityNullifiedRound: null, revelationRounds: 0 },
    rng: createRng(opts.seed), log: [], nextEventId: 1, outcome: null,
  };
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
  flushPending(ctx);
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
  for (const side of st.sides) for (const c of side.combatants) {
    c.dodgingThisRound = false;
    c.actedThisRound = false;
    c.flinched = false;
    c.damagedThisRound = false;
  }
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

  const ordered = orderDesc(ctx, pending, (p) => [speedOf(ctx, p.c)], 'round_start_materialization', (p) => p.c.uid);
  for (const p of ordered) {
    if (p.opened) {
      sideOf(st, p.pos.side).positions.push(p.pos);
      emit(st, { type: 'position_opened', targets: [p.pos.id], ruleRef: 'CANON-MECHANICS 13.2' });
    } else {
      emit(st, { type: 'rule_gap', targets: [p.pos.id], data: { gap: 'GAP-EMPTY-POSITION-FILL' } });
    }
    materializeWithEntry(ctx, p.c, p.pos);
    flushPending(ctx);
  }

  for (const side of st.sides) for (const c of side.combatants) c.presentAtDeclaration = c.location === 'field';
  st.phase = 'declaration';
  return st;
}

interface Frozen {
  positionId: string;
  side: SideIndex;
  actorUid: string;
  action: Action;
  done?: boolean;
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

// Toda marca "hasta su siguiente accion" termina al empezar esa accion
function startAction(c: Combatant): void {
  c.actedThisRound = true;
  c.marks = c.marks.filter((m) => m.expires.kind !== 'next_action');
}

function fail(ctx: EngineCtx, f: Frozen, reason: string, ruleRef: string): void {
  f.done = true;
  startAction(combatant(ctx.st, f.actorUid));
  emit(ctx.st, { type: 'action_failed', actor: f.actorUid, targets: [f.positionId], data: { action: f.action.kind, reason }, ruleRef });
}

function stillOccupies(ctx: EngineCtx, f: Frozen): Combatant | null {
  const c = combatant(ctx.st, f.actorUid);
  return c.location === 'field' && c.positionId === f.positionId ? c : null;
}

// Caza espectral: intercepta a la criatura saliente antes de su Intercambio, sin usar Prioridad
function interceptSwitch(ctx: EngineCtx, sw: Frozen, frozen: Frozen[]): void {
  for (const f of frozen) {
    if (f.done || f.side === sw.side || (f.action.kind !== 'technique' && f.action.kind !== 'partial')) continue;
    const t = ctx.data.techniques.get(f.action.techniqueId);
    const ic = t?.override?.interceptSwitch;
    if (!t || !ic) continue;
    const tgt = f.action.target;
    if (tgt.kind !== 'position' || tgt.positionId !== sw.positionId) continue;
    const hunter = combatant(ctx.st, f.actorUid);
    const prey = combatant(ctx.st, sw.actorUid);
    if (f.action.kind === 'technique' && (hunter.location !== 'field' || hunter.positionId !== f.positionId)) continue;
    if (prey.location !== 'field') continue;
    f.done = true;
    startAction(hunter);
    const mark = { kind: 'next_damage_bonus' as const, source: `${t.id}:intercepcion`, by: hunter.uid, expires: { kind: 'exit' as const }, params: { pct: ic.damagePct } };
    hunter.marks.push(mark);
    const ev = emit(ctx.st, { type: 'intercept', actor: hunter.uid, targets: [prey.uid], data: { technique: t.id }, ruleRef: 'CANON-TECHNIQUES Caza espectral' });
    executeTechnique(ctx, t, hunter, tgt, ev, f.action.kind === 'partial');
    hunter.marks = hunter.marks.filter((m) => m !== mark);
  }
}

// CANON-MECHANICS 16.3 / 28.3
function resolveSwitch(ctx: EngineCtx, f: Frozen, frozen: Frozen[]): void {
  if (f.action.kind !== 'switch') return;
  interceptSwitch(ctx, f, frozen);
  const out = stillOccupies(ctx, f);
  if (!out) return fail(ctx, f, 'la criatura saliente ya no ocupa la posicion', 'CANON-MECHANICS 14.3');
  const blocker = withdrawBlocker(out, true);
  if (blocker) return fail(ctx, f, `${blocker}: la Retirada voluntaria se ha vuelto ilegal`, 'CANON-MECHANICS 16.4 / 24.5');
  const incoming = sideOf(ctx.st, f.side).combatants.find((c) => c.creature.id === (f.action as { incomingId: string }).incomingId);
  if (!incoming || !isViableReserve(incoming)) return fail(ctx, f, 'el reemplazo ya no es viable', 'CANON-MECHANICS 16.4');
  f.done = true;
  const pos = findPosition(ctx.st, f.positionId)!;
  startAction(out);
  const ev = emit(ctx.st, { type: 'switch', actor: out.uid, targets: [pos.id], data: { incoming: incoming.uid }, ruleRef: 'CANON-MECHANICS 16.3' });
  exitField(ctx, out, 'withdraw', ev);
  materializeWithEntry(ctx, incoming, pos, ev);
  flushPending(ctx, ev);
}

// CANON-MECHANICS 17 / 28.4
function resolveDodge(ctx: EngineCtx, f: Frozen): void {
  const c = stillOccupies(ctx, f);
  if (!c) return fail(ctx, f, 'la criatura ya no ocupa la posicion', 'CANON-MECHANICS 14.3');
  f.done = true;
  startAction(c);
  const chance = dodgeChance(c.dodgeStreak);
  const r = roll(ctx, `dodge:${c.uid}`, chance);
  c.dodgeStreak++;
  c.dodgingThisRound = r.result;
  c.lastTurnTechniqueId = null;
  emit(ctx.st, { type: r.result ? 'dodge_success' : 'dodge_fail', actor: c.uid, data: { consecutiveUse: c.dodgeStreak, chance }, rolls: [r], ruleRef: 'CANON-MECHANICS 17' });
}

// CANON-MECHANICS 18.1 con modificaciones de Prioridad (fase, marcas, Anular prioridad)
export function effectivePriority(ctx: EngineCtx, t: Technique, user: Combatant): number {
  const phase = t.override?.phases ? ((user.techUses[t.id] ?? 0) % t.override.phases) + 1 : 1;
  let p = t.priority;
  for (const o of techniquePassiveOps(ctx, t, { subject: user, user, technique: t, phase }, 'modifyPriority')) p += Number(o.delta);
  if (user.location === 'field') for (const a of auraOps(ctx, user, 'modifyPriority', { subject: user, user, technique: t })) p += Number(a.op.delta);
  for (const m of marksOf(user, 'priority_mod')) p += Number(m.params.delta);
  if (ctx.st.field.priorityNullifiedRound === ctx.st.round && p > 0) p = 0;
  return p;
}

function actionKey(ctx: EngineCtx, f: Frozen): number[] {
  const a = f.action as { techniqueId: string };
  const c = combatant(ctx.st, f.actorUid);
  const t = ctx.data.techniques.get(a.techniqueId)!;
  const continuing = c.charging?.techniqueId === t.id;
  const speed = speedOf(ctx, c);
  // Velocidad invertida: dentro de la misma Prioridad actua antes la mas lenta
  return [continuing ? t.priority : effectivePriority(ctx, t, c), ctx.st.field.trickRoomRounds > 0 ? -speed : speed];
}

// CANON-MECHANICS 28.5.15
function resolveAction(ctx: EngineCtx, f: Frozen): void {
  const a = f.action;
  if (a.kind !== 'technique' && a.kind !== 'partial') return;
  const t = ctx.data.techniques.get(a.techniqueId)!;
  if (a.kind === 'partial') {
    const pos = findPosition(ctx.st, f.positionId);
    const c = combatant(ctx.st, f.actorUid);
    if (!pos || pos.occupantUid !== null || !isViableReserve(c)) return fail(ctx, f, 'la Materializacion parcial ya no es posible', 'CANON-MECHANICS 14.3');
    const blocked = techniqueBlockReason(ctx, c, t, true);
    if (blocked) return fail(ctx, f, blocked, 'CANON-MECHANICS 14.3');
    f.done = true;
    startAction(c);
    pos.partialUid = c.uid;
    const ev = emit(ctx.st, { type: 'partial_materialization', actor: c.uid, targets: [pos.id], data: { technique: t.id }, ruleRef: 'CANON-MECHANICS 1 (Materializacion parcial) / 32' });
    executeTechnique(ctx, t, c, a.target, ev, true, a.choice);
    pos.partialUid = null;
    emit(ctx.st, { type: 'partial_end', actor: c.uid, targets: [pos.id], cause: ev, ruleRef: 'CANON-MECHANICS 32' });
    return;
  }
  const c = stillOccupies(ctx, f);
  if (!c) return fail(ctx, f, 'el usuario ya no esta activo; la accion se pierde', 'CANON-MECHANICS 16.6 / 28.5.15');
  if (c.flinched) return fail(ctx, f, 'retrocede y no puede actuar este turno', 'CANON-TECHNIQUES / GAP-FLINCH');
  const continuing = c.charging?.techniqueId === t.id;
  if (!continuing) {
    const blocked = techniqueBlockReason(ctx, c, t, false);
    if (blocked) return fail(ctx, f, blocked, 'CANON-MECHANICS 14.3');
  }
  f.done = true;
  startAction(c);
  c.dodgeStreak = 0;
  c.lastTurnTechniqueId = t.id;
  const skip = (t.override?.chargeSkipEnvironment ?? []).includes(ctx.st.environment?.id ?? '');
  if (t.override?.charge && !continuing && !skip) {
    c.charging = { techniqueId: t.id, target: a.target };
    c.committedTechnique ??= t.id;
    emit(ctx.st, { type: 'charge_start', actor: c.uid, data: { technique: t.id }, ruleRef: 'CANON-MECHANICS 19.5' });
    return;
  }
  const target = continuing ? c.charging!.target : a.target;
  c.charging = null;
  const ev = emit(ctx.st, { type: 'technique', actor: c.uid, targets: target.kind === 'position' ? [target.positionId] : [], data: { technique: t.id, priority: t.priority, chargeSkipped: skip || undefined }, ruleRef: 'CANON-MECHANICS 18' });
  executeTechnique(ctx, t, c, target, ev, false, a.choice);
}

function hadTurn(c: Combatant): boolean {
  return c.presentAtDeclaration && c.location === 'field';
}

// Marcas periodicas, marcas de muerte y expiraciones de fin de ronda
function endOfRoundMarks(ctx: EngineCtx): void {
  const st = ctx.st;
  const present = orderDesc(ctx, st.sides.flatMap((s) => s.combatants).filter((c) => c.location === 'field'), (c) => [speedOf(ctx, c)], 'end_of_round', (c) => c.uid);
  for (const c of present) {
    for (const m of marksOf(c, 'periodic')) {
      if (c.location !== 'field') break;
      if (typeof m.params.heal === 'number') heal(ctx, c, (c.maxHp * m.params.heal) / 100, m.source);
      if (typeof m.params.loss === 'number') {
        const pct = m.params.loss + Number(m.params.accumulated ?? 0);
        const ev = emit(st, { type: 'periodic', actor: m.by, targets: [c.uid], data: { source: m.source, pct } });
        loseHp(ctx, c, (c.maxHp * pct) / 100, m.source, ev, 'periodic_damage');
        if (typeof m.params.increment === 'number') m.params.accumulated = Number(m.params.accumulated ?? 0) + m.params.increment;
        defeatIfZero(ctx, c, ev);
      }
    }
    for (const m of marksOf(c, 'death')) {
      if (c.location === 'field' && st.round >= Number(m.params.atEndOfRound)) {
        const ev = emit(st, { type: 'death_mark', actor: m.by, targets: [c.uid], data: { source: m.source, gap: 'GAP-CANTO-COUNT' } });
        loseHp(ctx, c, c.hp, m.source, ev, 'death_mark_damage');
        defeatIfZero(ctx, c, ev);
      }
    }
    flushPending(ctx);
  }
  for (const c of st.sides.flatMap((s) => s.combatants)) {
    for (const m of [...c.marks]) {
      const e = m.expires;
      let gone = false;
      if (e.kind === 'end_of_round') gone = st.round >= e.round;
      else if (e.kind === 'rounds') gone = --e.left <= 0;
      if (!gone) continue;
      removeMark(c, m);
      if (m.kind === 'temp_stage' && c.location === 'field') {
        const stat = m.params.stat as StageKey;
        c.stages[stat] = clampStage(c.stages[stat] - Number(m.params.applied ?? 0));
        emit(st, { type: 'stage', targets: [c.uid], data: { stat, to: c.stages[stat], source: m.source, reverted: true, gap: 'GAP-TEMP-STAGE' } });
      }
      emit(st, { type: 'mark_expired', targets: [c.uid], data: { kind: m.kind, source: m.source } });
    }
  }
  const f = st.field;
  if (f.trickRoomRounds > 0 && --f.trickRoomRounds === 0) emit(st, { type: 'field_flag_expired', data: { flag: 'trick_room' } });
  if (f.revelationRounds > 0 && --f.revelationRounds === 0) emit(st, { type: 'field_flag_expired', data: { flag: 'revelation' } });
}

// CANON-MECHANICS 28.6
function closeRound(ctx: EngineCtx, surrendered: Set<SideIndex>): void {
  const st = ctx.st;
  st.phase = 'close';
  const turnHolders = orderDesc(ctx, st.sides.flatMap((s) => s.combatants).filter(hadTurn), (c) => [speedOf(ctx, c)], 'end_of_turn', (c) => c.uid);
  for (const c of turnHolders) {
    for (const s of c.statuses) {
      const dot = ctx.data.statuses.get(s.id)?.damageOverTime;
      if (!dot || c.location !== 'field') continue;
      const loss = Math.min(c.hp, Math.max(0, Math.round((c.maxHp * dot.pctMaxHp) / 100)));
      const before = c.hp;
      c.hp -= loss;
      const ev = emit(st, { type: 'status_damage', actor: c.uid, data: { status: s.id, loss, before, after: c.hp, gap: 'GAP-DOT-ROUNDING' }, ruleRef: `CANON-MECHANICS ${ctx.data.statuses.get(s.id)?.section ?? '24'}` });
      afterHpLoss(ctx, c, before, ev);
      defeatIfZero(ctx, c, ev);
      flushPending(ctx, ev);
    }
    // Manifestaciones periodicas y Climas/Campos "por turno"
    if (c.location === 'field') {
      runAuras(ctx, c, 'end_of_turn');
      defeatIfZero(ctx, c);
      flushPending(ctx);
    }
  }
  endOfRoundMarks(ctx);
  emit(st, { type: 'end_of_round', ruleRef: 'CANON-MECHANICS 28.6.17' });

  for (const c of turnHolders) {
    if (!hadTurn(c)) continue;
    c.turnsMaterialized++;
    c.turnsSinceEntry++;
    for (const s of c.statuses) for (const k of Object.keys(s.counters)) if ((s.counters[k] ?? 0) > 0) s.counters[k]!--;
    for (const m of [...c.marks]) if (m.expires.kind === 'turns' && --m.expires.left <= 0) removeMark(c, m);
  }
  emit(st, { type: 'counters_advanced', data: { creatures: turnHolders.filter(hadTurn).map((c) => c.uid), gap: 'GAP-TURN-PREDICATE' }, ruleRef: 'CANON-MECHANICS 24.2 / 28.6.18' });
  for (const side of st.sides) {
    for (const e of side.sideEffects) e.roundsLeft--;
    for (const e of side.sideEffects.filter((x) => x.roundsLeft <= 0)) emit(st, { type: 'side_effect_expired', data: { side: side.index, id: e.id } });
    side.sideEffects = side.sideEffects.filter((e) => e.roundsLeft > 0);
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
  endOfRoundReplacements(ctx);
  ctx.deferReplacements = false;
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
  ctx.declared = new Map(frozen.map((f) => [f.actorUid, f.action]));
  ctx.deferReplacements = true;
  for (const f of frozen) emit(st, { type: 'declaration', actor: f.actorUid, targets: [f.positionId], data: { action: f.action }, ruleRef: 'CANON-MECHANICS 14.1' });

  st.phase = 'switches';
  const switchKey = (x: Frozen) => [speedOf(ctx, combatant(st, x.actorUid))];
  let switchQueue = orderDesc(ctx, frozen.filter((f) => f.action.kind === 'switch'), switchKey, 'switch_order', (x) => x.actorUid);
  let switchKeys = new Map(switchQueue.map((x) => [x, switchKey(x)]));
  while (switchQueue.length > 0) {
    resolveSwitch(ctx, switchQueue.shift()!, frozen);
    const next = reorderPending(ctx, switchQueue, switchKeys, switchKey, 'switch_reorder');
    if (next) switchQueue = next;
  }

  st.phase = 'dodges';
  for (const f of frozen.filter((x) => x.action.kind === 'dodge')) resolveDodge(ctx, f);

  st.phase = 'actions';
  const key = (f: Frozen) => actionKey(ctx, f);
  let queue = orderDesc(ctx, frozen.filter((f) => !f.done && (f.action.kind === 'technique' || f.action.kind === 'partial')), key, 'action_order', (x) => x.actorUid);
  emit(st, { type: 'action_order', data: { order: queue.map((f) => f.actorUid) }, ruleRef: 'CANON-MECHANICS 28.5.12-14' });
  let keys = new Map(queue.map((f) => [f, key(f)]));
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (f.done) continue;
    resolveAction(ctx, f);
    const next = reorderPending(ctx, queue.filter((x) => !x.done), keys, key, 'action_reorder');
    if (next) queue = next;
  }
  endOfRoundReplacements(ctx);

  closeRound(ctx, new Set(frozen.filter((f) => f.action.kind === 'surrender').map((f) => f.side)));
  return st;
}

// GAP-REPLACEMENT-TIMING: los Reemplazos por Derrota se resuelven al terminar las acciones de la ronda, con toda su cadena de Entrada
function endOfRoundReplacements(ctx: EngineCtx): void {
  ctx.deferReplacements = false;
  flushPending(ctx);
  ctx.deferReplacements = true;
}

const sameKeys = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// GAP-ORDER-DYNAMIC: tras cada accion se recalculan Prioridad y Velocidad de las acciones pendientes (18, 28.5.12-14);
// los empates ya resueltos se conservan y solo los empates nuevos se sortean
function reorderPending(ctx: EngineCtx, queue: Frozen[], keys: Map<Frozen, number[]>, keyOf: (f: Frozen) => number[], purpose: string): Frozen[] | null {
  const now = new Map(queue.map((f) => [f, keyOf(f)]));
  if (queue.every((f) => sameKeys(now.get(f)!, keys.get(f)!))) return null;
  const pos = new Map(queue.map((f, i) => [f, i]));
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  const sorted = [...queue].sort((a, b) => cmp(now.get(a)!, now.get(b)!) || pos.get(a)! - pos.get(b)!);
  const out: Frozen[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && cmp(now.get(sorted[i]!)!, now.get(sorted[j]!)!) === 0) j++;
    const group = sorted.slice(i, j);
    const newTie = group.some((f) => !sameKeys(keys.get(f)!, keys.get(group[0]!)!));
    out.push(...(newTie ? orderDesc(ctx, group, () => [0], purpose, (x) => x.actorUid) : group));
    i = j;
  }
  for (const [f, k] of now) keys.set(f, k);
  const changed = out.some((f, i) => f !== queue[i]);
  if (changed) {
    emit(ctx.st, {
      type: 'action_order',
      data: { order: out.map((f) => f.actorUid), reordered: true, keys: out.map((f) => now.get(f)), phase: purpose },
      ruleRef: 'CANON-MECHANICS 18 / 28.5.12-14',
    });
  }
  return out;
}
