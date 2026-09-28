import type { Manifestation, Technique } from '../../data/schema.js';
import type { Combatant, SideIndex } from '../model/battle.js';
import type { StatusId } from '../model/types.js';
import type { Condition, Effect, Op, Trigger } from './dsl.js';
import { manifestationAvailability } from './availability.js';
import { emit } from '../log/events.js';
import { allCombatants, roll, sideOf, type EngineCtx } from '../pipeline/context.js';
import { applyStatus, restrictionActive } from '../pipeline/combatant.js';

export interface EvalScope {
  subject: Combatant;
  user?: Combatant;
  target?: Combatant;
  technique?: Technique;
  partial?: boolean;
}

export function evalCondition(c: Condition | undefined, s: EvalScope): boolean {
  if (!c) return true;
  const t = s.technique;
  if (c.techniqueType && !(t?.type && c.techniqueType.includes(t.type))) return false;
  if (c.techniqueClass && !(t && c.techniqueClass.includes(t.class))) return false;
  if (c.subjectTypes && !s.subject.creature.types.some((x) => c.subjectTypes!.includes(x))) return false;
  if (c.subjectNotTypes && s.subject.creature.types.some((x) => c.subjectNotTypes!.includes(x))) return false;
  if (c.targetHasAnyStatus !== undefined && (s.target ? s.target.statuses.length > 0 : false) !== c.targetHasAnyStatus) return false;
  if (c.targetHpBelowPct !== undefined && !(s.target && s.target.hp < (s.target.maxHp * c.targetHpBelowPct) / 100)) return false;
  if (c.targetHasNotActed !== undefined && (s.target ? !s.target.actedThisRound : false) !== c.targetHasNotActed) return false;
  if (c.userFirstTurnSinceEntry !== undefined) {
    // GAP-PARTIAL-FIRST-TURN: la Materializacion parcial cuenta como materializacion
    const first = s.partial === true || (s.user?.turnsSinceEntry ?? 1) === 0;
    if (first !== c.userFirstTurnSinceEntry) return false;
  }
  return true;
}

export function environmentManifestation(ctx: EngineCtx): Manifestation | null {
  const env = ctx.st.environment;
  return env ? ctx.data.manifestations.get(env.id) ?? null : null;
}

export function environmentEffects(ctx: EngineCtx, trigger: Trigger): Effect[] {
  return (environmentManifestation(ctx)?.override?.effects ?? []).filter((e) => e.trigger === trigger);
}

// CANON-MECHANICS 10.7 / 24.10: pasivas solo con la criatura completamente materializada
export function manifestationInactiveReason(ctx: EngineCtx, c: Combatant, m: Manifestation): string | null {
  const a = manifestationAvailability(m);
  if (!a.executable) return a.reason ?? 'no implementada';
  if (c.location !== 'field') return 'la criatura no esta completamente materializada';
  if (restrictionActive(c, 'manifestations_disabled') && !m.override?.worksWhileDesvinculado) return 'Desvinculado (24.10)';
  for (const e of environmentEffects(ctx, 'environment')) {
    if (e.ops.some((o) => o.op === 'disableManifestations') && evalCondition(e.condition, { subject: c })) {
      return `desactivada por ${ctx.st.environment!.id}`;
    }
  }
  return null;
}

export function activeManifestations(ctx: EngineCtx, c: Combatant): Manifestation[] {
  return c.creature.equippedManifestations
    .map((id) => ctx.data.manifestations.get(id))
    .filter((m): m is Manifestation => !!m && manifestationInactiveReason(ctx, c, m) === null);
}

export interface DamageModifier {
  pct: number;
  source: string;
}

function collectModify(effects: Effect[], role: 'dealt' | 'taken', scope: EvalScope, source: string, out: DamageModifier[]): void {
  for (const e of effects) {
    if (!evalCondition(e.condition, scope)) continue;
    for (const o of e.ops) if (o.op === 'modifyDamage' && o.role === role && !o.oncePerEntry) out.push({ pct: Number(o.pct), source });
  }
}

// CANON-MECHANICS 23.2: todos los porcentajes de dano se suman en M
export function damageModifiers(ctx: EngineCtx, t: Technique, user: Combatant, target: Combatant, partial: boolean): DamageModifier[] {
  const out: DamageModifier[] = [];
  if (!partial) {
    for (const m of activeManifestations(ctx, user)) {
      collectModify((m.override?.effects ?? []).filter((e) => e.trigger === 'passive'), 'dealt', { subject: user, user, target, technique: t }, m.id, out);
    }
  }
  for (const m of activeManifestations(ctx, target)) {
    collectModify((m.override?.effects ?? []).filter((e) => e.trigger === 'passive'), 'taken', { subject: target, user, target, technique: t }, m.id, out);
  }
  const env = environmentEffects(ctx, 'environment');
  const envId = ctx.st.environment?.id ?? '';
  collectModify(env, 'dealt', { subject: user, user, target, technique: t }, envId, out);
  collectModify(env, 'taken', { subject: target, user, target, technique: t }, envId, out);
  return out;
}

// Bonificaciones de "la siguiente tecnica ... despues de entrar": una vez por Entrada
export function oncePerEntryBonuses(ctx: EngineCtx, t: Technique, user: Combatant, partial: boolean): DamageModifier[] {
  if (partial) return [];
  const out: DamageModifier[] = [];
  for (const m of activeManifestations(ctx, user)) {
    if (user.entryBonusesUsed.includes(m.id)) continue;
    for (const e of m.override?.effects ?? []) {
      if (e.trigger !== 'passive' || !evalCondition(e.condition, { subject: user, user, technique: t })) continue;
      for (const o of e.ops) if (o.op === 'modifyDamage' && o.oncePerEntry) out.push({ pct: Number(o.pct), source: m.id });
    }
  }
  return out;
}

export interface AccuracyEffects {
  relativePct: number[];
  percentagePoints: number[];
  neverMiss: boolean;
  sources: string[];
}

export function accuracyEffects(ctx: EngineCtx, t: Technique, user: Combatant, partial: boolean): AccuracyEffects {
  const out: AccuracyEffects = { relativePct: [], percentagePoints: [], neverMiss: false, sources: [] };
  const sources: { effects: Effect[]; id: string }[] = [];
  if (!partial) for (const m of activeManifestations(ctx, user)) sources.push({ effects: (m.override?.effects ?? []).filter((e) => e.trigger === 'passive'), id: m.id });
  sources.push({ effects: environmentEffects(ctx, 'environment'), id: ctx.st.environment?.id ?? '' });
  for (const s of sources) {
    for (const e of s.effects) {
      if (!evalCondition(e.condition, { subject: user, user, technique: t })) continue;
      for (const o of e.ops) {
        if (o.op !== 'modifyAccuracy') continue;
        if (o.neverMiss) out.neverMiss = true;
        if (typeof o.pct === 'number') out.relativePct.push(o.pct);
        if (typeof o.pp === 'number') out.percentagePoints.push(o.pp);
        out.sources.push(s.id);
      }
    }
  }
  return out;
}

export interface RunScope extends EvalScope {
  source: string;
  sourceKind: 'technique' | 'manifestation' | 'environment';
  cause?: number;
}

export interface RunResult {
  failed: boolean;
}

function enemiesOf(ctx: EngineCtx, side: SideIndex): Combatant[] {
  return sideOf(ctx.st, side === 0 ? 1 : 0).combatants.filter((c) => c.location === 'field');
}

function resolveTargets(ctx: EngineCtx, e: Effect, s: RunScope): Combatant[] {
  switch (e.target) {
    case 'self': return [s.subject];
    case 'target': return s.target ? [s.target] : [];
    case 'all_enemies': return enemiesOf(ctx, s.subject.side);
    case 'all_allies': return sideOf(ctx.st, s.subject.side).combatants.filter((c) => c.location === 'field');
    case 'all_present': return allCombatants(ctx.st).filter((c) => c.location === 'field');
    case 'position': return s.target ? [s.target] : [];
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
      if (e.trigger !== trigger || !evalCondition(e.condition, s)) continue;
      for (const target of resolveTargets(ctx, e, s)) {
        for (const o of e.ops) {
          if (runOp(ctx, o, e, target, s)) result.failed = true;
        }
      }
    }
  } finally {
    ctx.depth = (ctx.depth ?? 1) - 1;
  }
  return result;
}

function runOp(ctx: EngineCtx, o: Op, e: Effect, target: Combatant, s: RunScope): boolean {
  const base = { actor: s.subject.uid, targets: [target.uid], cause: s.cause, ruleRef: e.ruleRef };
  switch (o.op) {
    case 'applyStatus': {
      if (target.location !== 'field') return false;
      const chance = typeof o.chance === 'number' ? o.chance : 100;
      const r = roll(ctx, `status:${String(o.status)}:${s.source}`, chance);
      if (!r.result) {
        emit(ctx.st, { ...base, type: 'status_not_applied', data: { status: o.status, source: s.source, chance }, rolls: [r] });
        return false;
      }
      const res = applyStatus(ctx.data, target, o.status as StatusId);
      emit(ctx.st, {
        ...base,
        type: res === 'applied' ? 'status_applied' : res === 'immune' ? 'status_immune' : 'status_already_present',
        data: { status: o.status, source: s.source, chance, secondary: e.flags?.isSecondaryEffect ?? false, gap: res === 'already_present' ? 'GAP-STATUS-REAPPLY' : undefined },
        rolls: r.roll === null ? undefined : [r],
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
    default:
      return false;
  }
}
