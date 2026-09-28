import type { Combatant, Mark, MarkKind, SideMod } from '../model/battle.js';
import { STAGE_KEYS, type StageKey, type StatusId } from '../model/types.js';
import type { Effect, Op, Trigger } from './dsl.js';
import { emit } from '../log/events.js';
import { roll, sideOf, type EngineCtx, type PendingSelfSwitch } from '../pipeline/context.js';
import { applyStatus } from '../pipeline/combatant.js';
import {
  addMark, auraOps, auras, changeStage, evalCondition, fieldCombatants, heal, loseHp, lowestAlly, statOf, toExpiry,
  type EvalScope, type ExpirySpec,
} from './runtime.js';

export interface RunScope extends EvalScope {
  source: string;
  sourceKind: 'technique' | 'manifestation' | 'environment' | 'mark';
  cause?: number;
  damageDealt?: number;
  healer?: Combatant | null;
  fromZero?: boolean;
}

export interface RunResult {
  failed: boolean;
}

// Ejecuta sobre `subject` las Manifestaciones y Climas que le alcanzan con ese disparador
export function runAuras(ctx: EngineCtx, subject: Combatant, trigger: Trigger, extra: Partial<RunScope> = {}): void {
  for (const a of auras(ctx, subject, trigger)) {
    const key = `${a.source}:${trigger}`;
    if (a.effect.flags?.oncePerBattle && subject.onceUsed.includes(key)) continue;
    const scope: RunScope = {
      ...extra, subject, source: a.source, sourceKind: a.carrier ? 'manifestation' : 'environment', healer: a.carrier ?? extra.healer ?? null,
      fromZero: trigger === 'on_hp_threshold',
    };
    if (!evalCondition(ctx, a.effect.condition, scope)) continue;
    if (a.effect.flags?.oncePerBattle) subject.onceUsed.push(key);
    const ev = emit(ctx.st, { type: 'manifestation', actor: a.carrier?.uid, targets: [subject.uid], data: { manifestation: a.source, trigger }, cause: extra.cause });
    runEffects(ctx, [{ ...a.effect, target: 'self', condition: undefined }], trigger, { ...scope, cause: ev });
  }
}

export function pendingSelfSwitches(ctx: EngineCtx): PendingSelfSwitch[] {
  ctx.selfSwitches ??= [];
  return ctx.selfSwitches;
}

const foesOf = (ctx: EngineCtx, c: Combatant) => sideOf(ctx.st, c.side === 0 ? 1 : 0).combatants.filter((x) => x.location === 'field');
const alliesOf = (ctx: EngineCtx, c: Combatant) => sideOf(ctx.st, c.side).combatants.filter((x) => x.location === 'field');

function resolveTargets(ctx: EngineCtx, e: Effect, s: RunScope): Combatant[] {
  switch (e.target) {
    case 'self': return [s.subject];
    case 'target':
    case 'position': return s.target ? [s.target] : [];
    case 'all_enemies': return foesOf(ctx, s.subject);
    case 'all_allies': return alliesOf(ctx, s.subject);
    case 'other_allies': return alliesOf(ctx, s.subject).filter((c) => c !== s.subject);
    case 'all_present': return fieldCombatants(ctx);
    case 'lowest_ally': {
      const l = lowestAlly(ctx, s.subject.side);
      return l ? [l] : [];
    }
  }
}

// CANON-MECHANICS 10.10: cada efecto se resuelve hasta sus ultimas consecuencias antes del siguiente
export function runEffects(ctx: EngineCtx, effects: Effect[], trigger: Trigger, s: RunScope): RunResult {
  const result: RunResult = { failed: false };
  if ((ctx.depth ?? 0) >= ctx.st.config.maxChainDepth) {
    emit(ctx.st, { type: 'rule_gap', data: { gap: 'GAP-CHAIN-DEPTH', source: s.source, trigger }, cause: s.cause, ruleRef: 'CANON-MECHANICS 10.10' });
    return result;
  }
  ctx.depth = (ctx.depth ?? 0) + 1;
  try {
    for (const e of effects) {
      if (e.trigger !== trigger || !evalCondition(ctx, e.condition, s)) continue;
      for (const target of resolveTargets(ctx, e, s)) {
        if (e.targetFilter && !evalCondition(ctx, e.targetFilter, { ...s, subject: target })) continue;
        for (const o of e.ops) if (runOp(ctx, o, e, target, s)) result.failed = true;
      }
    }
  } finally {
    ctx.depth = (ctx.depth ?? 1) - 1;
  }
  return result;
}

function statsParam(o: Op, subject: Combatant): StageKey[] {
  const raw = (o.stats as string[] | undefined) ?? (o.stat ? [String(o.stat)] : []);
  return raw.map((x) => (x === '$instinct' ? subject.creature.instinct ?? '' : x)).filter((x): x is StageKey => STAGE_KEYS.includes(x as StageKey));
}

const MARK_META = new Set(['op', 'kind', 'expires', 'uses', 'barrier', 'evasion']);

function runOp(ctx: EngineCtx, o: Op, e: Effect, target: Combatant, s: RunScope): boolean {
  const base = { actor: s.subject.uid, targets: [target.uid], cause: s.cause, ruleRef: e.ruleRef };
  const chanceOk = () => {
    const chance = typeof o.chance === 'number' ? o.chance : 100;
    const r = roll(ctx, `${o.op}:${s.source}`, chance);
    if (!r.result) emit(ctx.st, { ...base, type: 'effect_not_triggered', data: { op: o.op, source: s.source, chance }, rolls: [r] });
    return r.result;
  };
  switch (o.op) {
    case 'applyStatus': {
      if (target.location !== 'field' || !chanceOk()) return false;
      const res = applyStatus(ctx.data, target, o.status as StatusId);
      emit(ctx.st, {
        ...base,
        type: res === 'applied' ? 'status_applied' : res === 'immune' ? 'status_immune' : 'status_already_present',
        data: { status: o.status, source: s.source, secondary: e.flags?.isSecondaryEffect ?? false, gap: res === 'already_present' ? 'GAP-STATUS-REAPPLY' : undefined },
        ruleRef: e.ruleRef ?? 'CANON-MECHANICS 24.1',
      });
      return false;
    }
    case 'setEnvironment': {
      const m = ctx.data.manifestations.get(s.source);
      if (!m?.environmentKind) return false;
      const previous = ctx.st.environment?.id ?? null;
      ctx.st.environment = { kind: m.environmentKind, id: m.id, sourceUid: s.subject.uid, sinceRound: ctx.st.round };
      emit(ctx.st, { ...base, targets: [], type: 'environment_set', data: { environment: m.id, kind: m.environmentKind, replaced: previous }, ruleRef: 'CANON-MECHANICS 25.1' });
      return false;
    }
    case 'clearEnvironment': {
      const env = ctx.st.environment;
      const m = env ? ctx.data.manifestations.get(env.id) : undefined;
      if (!env || !m) return false;
      if (o.kind && env.kind !== o.kind) return false;
      if (o.element && m.element !== o.element) return false;
      ctx.st.environment = null;
      emit(ctx.st, { ...base, targets: [], type: 'environment_cleared', data: { environment: env.id, source: s.source } });
      return false;
    }
    case 'flinch': {
      if (target.location !== 'field') return false;
      if (target.actedThisRound || !target.presentAtDeclaration) {
        emit(ctx.st, { ...base, type: 'flinch_no_effect', data: { source: s.source, reason: target.actedThisRound ? 'ya ha actuado' : 'sin accion pendiente' } });
        return false;
      }
      target.flinched = true;
      emit(ctx.st, { ...base, type: 'flinch', data: { source: s.source, secondary: e.flags?.isSecondaryEffect ?? false, gap: 'GAP-FLINCH' } });
      return false;
    }
    case 'failTechnique':
      emit(ctx.st, { ...base, targets: [], type: 'technique_failed', data: { source: s.source } });
      return true;
    case 'stage': {
      if (!chanceOk()) return false;
      for (const stat of statsParam(o, s.subject)) changeStage(ctx, target, stat, Number(o.n), s.source, s.cause);
      return false;
    }
    case 'clearStages': {
      const stats = o.stats ? statsParam(o, s.subject) : [...STAGE_KEYS];
      let picked = stats.filter((k) => (o.positive && target.stages[k] > 0) || (o.negative && target.stages[k] < 0));
      // GAP-CURE-ONE: con count se eligen primero las etapas mas extremas
      if (typeof o.count === 'number') picked = picked.sort((a, b) => Math.abs(target.stages[b]) - Math.abs(target.stages[a])).slice(0, o.count);
      for (const k of picked) {
        const from = target.stages[k];
        target.stages[k] = 0;
        emit(ctx.st, { ...base, type: 'stage', data: { stat: k, from, to: 0, delta: -from, source: s.source, cleared: true }, ruleRef: 'CANON-MECHANICS 21.2' });
      }
      return false;
    }
    case 'stealStage': {
      // GAP-STEAL-CHOICE: se roba la etapa positiva mas alta (empate: orden Ataque, Ataque magico, Defensa, Defensa magica, Velocidad, Precision)
      const k = [...STAGE_KEYS].filter((x) => target.stages[x] > 0).sort((a, b) => target.stages[b] - target.stages[a])[0];
      if (!k || target === s.subject) return false;
      target.stages[k] -= 1;
      emit(ctx.st, { ...base, type: 'stage', data: { stat: k, from: target.stages[k] + 1, to: target.stages[k], delta: -1, source: s.source, stolen: true, gap: 'GAP-STEAL-CHOICE' } });
      changeStage(ctx, s.subject, k, 1, s.source, s.cause);
      return false;
    }
    case 'stageHighest': {
      const stats = statsParam(o, s.subject).filter((k): k is Exclude<StageKey, 'accuracy'> => k !== 'accuracy');
      const best = stats.reduce((a, b) => (statOf(ctx, target, b) > statOf(ctx, target, a) ? b : a), stats[0]!);
      changeStage(ctx, target, best, Number(o.n), s.source, s.cause);
      return false;
    }
    case 'convertStages': {
      const from = statsParam({ op: 'stage', stats: o.from } as Op, s.subject);
      const to = statsParam({ op: 'stage', stats: o.to } as Op, s.subject);
      let removed = 0;
      for (const k of from) if (target.stages[k] > 0) {
        removed += target.stages[k];
        emit(ctx.st, { ...base, type: 'stage', data: { stat: k, from: target.stages[k], to: 0, source: s.source, cleared: true } });
        target.stages[k] = 0;
      }
      // GAP-BLINDAJE-CAP: se ganan como maximo `max` etapas por caracteristica
      for (const k of to) changeStage(ctx, target, k, Math.min(removed, Number(o.max ?? 6)), s.source, s.cause);
      return false;
    }
    case 'heal': {
      const baseAmount = typeof o.pctOfDamage === 'number' ? ((s.damageDealt ?? 0) * o.pctOfDamage) / 100 : (target.maxHp * Number(o.pct)) / 100;
      heal(ctx, target, baseAmount, s.source, s.cause, s.partial && target === s.subject, s.healer ?? s.subject, s.fromZero && target === s.subject);
      return false;
    }
    case 'drain':
      heal(ctx, s.subject, ((s.damageDealt ?? 0) * Number(o.pct)) / 100, s.source, s.cause, s.partial, s.subject);
      return false;
    case 'distributeHeal': {
      const allies = sideOf(ctx.st, s.subject.side).combatants.filter((c) => c.location === 'field');
      const total = ((s.damageDealt ?? 0) * Number(o.pctOfDamage)) / 100;
      // GAP-DISTRIBUTE-HEAL: reparto a partes iguales entre los aliados presentes (incluido el usuario)
      for (const a of allies) heal(ctx, a, total / allies.length, s.source, s.cause, false, s.subject);
      return false;
    }
    case 'typedLoss': {
      // GAP-ENV-DAMAGE: perdida fija de Vitalidad maxima; solo la modifican los "dano de X recibido" de ese tipo
      const pseudo = { id: s.source, type: o.type, class: 'status', category: 'elemental' } as never;
      const pct = auraOps(ctx, target, 'modifyDamage', { subject: target, technique: pseudo })
        .filter((a) => a.op.role === 'taken').reduce((acc, a) => acc + Number(a.op.pct), 0);
      loseHp(ctx, target, (target.maxHp * Number(o.pctMaxHp) * Math.max(0, 1 + pct / 100)) / 100, s.source, s.cause, 'environment_damage');
      return false;
    }
    case 'recoil':
      loseHp(ctx, s.subject, ((s.damageDealt ?? 0) * Number(o.pct)) / 100, s.source, s.cause, 'recoil', s.partial);
      return false;
    case 'selfDamage': {
      const amount = typeof o.pctCurrentHp === 'number' ? (target.hp * o.pctCurrentHp) / 100 : (target.maxHp * Number(o.pctMaxHp)) / 100;
      loseHp(ctx, target, amount, s.source, s.cause, 'self_damage', s.partial && target === s.subject);
      return false;
    }
    case 'cureStatuses': {
      if (target.location !== 'field') return false;
      let cured = o.all ? target.statuses : target.statuses.filter((x) => (o.ids as string[] | undefined)?.includes(x.id));
      if (typeof o.count === 'number') cured = cured.slice(0, o.count);
      for (const st of cured) emit(ctx.st, { ...base, type: 'status_cured', data: { status: st.id, source: s.source, gap: typeof o.count === 'number' ? 'GAP-CURE-ONE' : undefined } });
      target.statuses = target.statuses.filter((x) => !cured.includes(x));
      return false;
    }
    case 'mark': {
      if (target.location !== 'field' || !chanceOk()) return false;
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) if (!MARK_META.has(k)) params[k] = v;
      params.byUid = s.subject.uid;
      params.bySide = s.subject.side;
      const mark: Mark = {
        kind: o.kind as MarkKind,
        source: s.source,
        by: s.subject.uid,
        expires: toExpiry(ctx, o.expires as ExpirySpec | undefined),
        uses: typeof o.uses === 'number' ? o.uses : undefined,
        barrier: o.barrier === true,
        evasion: o.evasion === true,
        params,
      };
      if (mark.barrier && mark.expires.kind === 'rounds') mark.expires.left += barrierBonus(ctx, s.subject);
      if (mark.kind === 'temp_stage') {
        const applied = changeStage(ctx, target, params.stat as StageKey, Number(params.delta), s.source, s.cause);
        mark.params.applied = applied;
      }
      // GAP-CANTO-COUNT: la ronda de uso cuenta como la primera
      if (mark.kind === 'death') mark.params.atEndOfRound = ctx.st.round + Number(params.rounds ?? 1) - 1;
      if (mark.kind === 'priority_mod') ctx.reorder = true;
      addMark(ctx, target, mark, s.cause);
      return false;
    }
    case 'removeMarks': {
      const before = target.marks.length;
      target.marks = target.marks.filter((m) => !((o.evasion && m.evasion) || (o.barriers && m.barrier) || (o.kinds as string[] | undefined)?.includes(m.kind)));
      if (target.marks.length !== before) emit(ctx.st, { ...base, type: 'marks_removed', data: { removed: before - target.marks.length, source: s.source } });
      return false;
    }
    case 'consumeMark': {
      const tag = String(o.tag);
      const before = target.marks.length;
      target.marks = target.marks.filter((m) => m.params.tag !== tag && m.source !== tag);
      if (target.marks.length !== before) emit(ctx.st, { ...base, type: 'mark_consumed', data: { tag, source: s.source } });
      return false;
    }
    case 'addSideEffect': {
      const side = sideOf(ctx.st, s.subject.side);
      const id = String(o.id ?? s.source);
      side.sideEffects = side.sideEffects.filter((x) => x.id !== id);
      const rounds = o.untilConsumed ? Number.MAX_SAFE_INTEGER : Number(o.rounds) + (o.barrier === true ? barrierBonus(ctx, s.subject) : 0);
      side.sideEffects.push({ id, sourceUid: s.subject.uid, roundsLeft: rounds, barrier: o.barrier === true, mods: (o.mods as SideMod[]) ?? [] });
      emit(ctx.st, { ...base, targets: [], type: 'side_effect_added', data: { side: side.index, id, rounds: o.untilConsumed ? 'hasta consumirse' : rounds, barrier: o.barrier === true }, ruleRef: 'CANON-MECHANICS 25.3' });
      return false;
    }
    case 'destroySideEffect': {
      const sideIdx = o.side === 'own' ? s.subject.side : o.side === 'target' && s.target ? s.target.side : s.subject.side === 0 ? 1 : 0;
      const side = sideOf(ctx.st, sideIdx);
      const ids = o.ids as string[] | undefined;
      const destroyed = side.sideEffects.filter((x) => ids?.includes(x.id) || (o.barriers === true && x.barrier));
      side.sideEffects = side.sideEffects.filter((x) => !destroyed.includes(x));
      for (const d of destroyed) emit(ctx.st, { ...base, targets: [], type: 'side_effect_destroyed', data: { side: sideIdx, id: d.id, source: s.source } });
      if (o.barriers === true) {
        for (const c of side.combatants) {
          const b = c.marks.filter((m) => m.barrier);
          if (b.length) {
            c.marks = c.marks.filter((m) => !m.barrier);
            emit(ctx.st, { ...base, targets: [c.uid], type: 'marks_removed', data: { removed: b.length, barriers: true, source: s.source } });
          }
        }
      }
      return false;
    }
    case 'setFieldFlag': {
      const f = ctx.st.field;
      if (o.flag === 'trick_room') {
        f.trickRoomRounds = Number(o.rounds);
        f.priorityNullifiedRound = null;
      } else if (o.flag === 'priority_nullified') {
        f.priorityNullifiedRound = ctx.st.round;
        f.trickRoomRounds = 0;
      } else if (o.flag === 'revelation') {
        f.revelationRounds = Number(o.rounds);
      }
      ctx.reorder = true;
      emit(ctx.st, { ...base, targets: [], type: 'field_flag', data: { flag: o.flag, rounds: o.rounds, source: s.source } });
      return false;
    }
    case 'lockTechnique': {
      const mark: Mark = o.type
        ? { kind: 'type_lock', source: s.source, by: s.subject.uid, expires: { kind: 'end_of_round', round: ctx.st.round + 1 }, params: { type: o.type } }
        : { kind: 'technique_lock', source: s.source, by: s.subject.uid, expires: { kind: 'exit' }, params: { techniqueId: s.technique?.id } };
      addMark(ctx, target, mark, s.cause);
      return false;
    }
    case 'selfSwitch':
      if (s.partial || s.subject.location !== 'field') return false;
      pendingSelfSwitches(ctx).push({ uid: s.subject.uid, mode: o.mode === 'optional' ? 'optional' : 'forced', ignoreRestrictions: o.ignoreRestrictions === true, random: o.random === true, source: s.source, cause: s.cause });
      return false;
    default:
      return false;
  }
}

// Fortificacion: las barreras creadas por sus tecnicas duran rondas adicionales
function barrierBonus(ctx: EngineCtx, c: Combatant): number {
  return auraOps(ctx, c, 'extendBarriers', { subject: c }).reduce((a, x) => a + Number(x.op.rounds ?? 0), 0);
}
