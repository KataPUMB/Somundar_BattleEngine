import type { Manifestation, StatusRestriction, Technique } from '../../data/schema.js';
import type { Combatant, Expiry, Mark, MarkKind, SideIndex } from '../model/battle.js';
import type { StageKey, StatKey, StatusId } from '../model/types.js';
import type { Condition, Effect, Trigger } from './dsl.js';
import { manifestationAvailability } from './availability.js';
import { emit } from '../log/events.js';
import { allCombatants, sideOf, type EngineCtx } from '../pipeline/context.js';
import { restrictionActive, statusModifiers } from '../pipeline/combatant.js';
import { clampStage, effectiveStat, type DirectModifier } from '../rules/stats.js';
import { runAuras } from './interpreter.js';

export interface EvalScope {
  subject: Combatant;
  user?: Combatant;
  target?: Combatant;
  technique?: Technique;
  partial?: boolean;
  choice?: string;
  hitsOnTarget?: number;
  phase?: number;
  charged?: boolean;
  hpBefore?: number;
}

const hasStage = (c: Combatant, sign: 1 | -1) => Object.values(c.stages).some((v) => v * sign > 0);
const pctHp = (c: Combatant) => (c.hp / c.maxHp) * 100;

// Mundano: una tecnica tiene efectos adicionales si su curado hace algo mas que retroceso (CANON-TECHNIQUES Terminologia)
export function hasAdditionalEffects(t: Technique): boolean {
  const ov = t.override;
  if (ov?.handler || ov?.splashPct || ov?.streak || ov?.phases || ov?.interceptSwitch) return true;
  return (ov?.effects ?? []).some((e) => e.ops.some((o) => o.op !== 'recoil'));
}

export function evalCondition(ctx: EngineCtx, c: Condition | undefined, s: EvalScope): boolean {
  if (!c) return true;
  const t = s.technique;
  const tg = s.target;
  const u = s.user ?? s.subject;
  if (c.techniqueType && !(t?.type && c.techniqueType.includes(t.type))) return false;
  if (c.techniqueClass && !(t && c.techniqueClass.includes(t.class))) return false;
  if (c.techniqueCategory && !(t && c.techniqueCategory.includes(t.category))) return false;
  if (c.techniqueTypeNotOwn !== undefined && !!(t?.type && !u.creature.types.includes(t.type)) !== c.techniqueTypeNotOwn) return false;
  if (c.techniqueHasAdditionalEffects !== undefined && !!t && hasAdditionalEffects(t) !== c.techniqueHasAdditionalEffects) return false;
  if (c.techniqueFirstUseEver !== undefined && !!t && !u.everUsed.includes(t.id) !== c.techniqueFirstUseEver) return false;
  if (c.techniqueCharged !== undefined && (s.charged === true) !== c.techniqueCharged) return false;
  if (c.subjectTypes && !s.subject.creature.types.some((x) => c.subjectTypes!.includes(x))) return false;
  if (c.subjectNotTypes && s.subject.creature.types.some((x) => c.subjectNotTypes!.includes(x))) return false;
  if (c.subjectHasStatus && !s.subject.statuses.some((x) => c.subjectHasStatus!.includes(x.id))) return false;
  if (c.subjectCharging !== undefined && (s.subject.charging !== null) !== c.subjectCharging) return false;
  if (c.subjectCanTransfigure !== undefined && (s.subject.creature.canTransfigure === true) !== c.subjectCanTransfigure) return false;
  if (c.targetHasAnyStatus !== undefined && (tg ? tg.statuses.length > 0 : false) !== c.targetHasAnyStatus) return false;
  if (c.targetHasStatus && !(tg && tg.statuses.some((x) => c.targetHasStatus!.includes(x.id)))) return false;
  if (c.targetHpBelowPct !== undefined && !(tg && pctHp(tg) < c.targetHpBelowPct)) return false;
  if (c.targetHasNotActed !== undefined && (tg ? !tg.actedThisRound : false) !== c.targetHasNotActed) return false;
  if (c.targetHasPositiveStage !== undefined && (tg ? hasStage(tg, 1) : false) !== c.targetHasPositiveStage) return false;
  if (c.targetHasNegativeStage !== undefined && (tg ? hasStage(tg, -1) : false) !== c.targetHasNegativeStage) return false;
  if (c.targetMissedLastDamaging !== undefined && (tg ? tg.lastDamagingMissed : false) !== c.targetMissedLastDamaging) return false;
  if (c.targetDeclaredStatusTechnique !== undefined) {
    const a = tg ? ctx.declared?.get(tg.uid) : undefined;
    const declaredStatus = !!a && (a.kind === 'technique' || a.kind === 'partial') && ctx.data.techniques.get(a.techniqueId)?.class === 'status';
    if (declaredStatus !== c.targetDeclaredStatusTechnique) return false;
  }
  if (c.targetHasMark && !(tg && tg.marks.some((m) => m.source === c.targetHasMark || m.params.tag === c.targetHasMark))) return false;
  if (c.userHasMark && !u.marks.some((m) => m.source === c.userHasMark || m.params.tag === c.userHasMark)) return false;
  if (c.userFirstTurnSinceEntry !== undefined) {
    // GAP-PARTIAL-FIRST-TURN: la Materializacion parcial cuenta como materializacion
    const first = s.partial === true || u.turnsSinceEntry === 0;
    if (first !== c.userFirstTurnSinceEntry) return false;
  }
  if (c.userHpBelowPct !== undefined && !(pctHp(u) < c.userHpBelowPct)) return false;
  if (c.userHpAtLeastPct !== undefined && !(pctHp(u) >= c.userHpAtLeastPct)) return false;
  if (c.userDamagedThisRound !== undefined && u.damagedThisRound !== c.userDamagedThisRound) return false;
  if (c.userDealtDamageLastRound !== undefined && (u.lastDamageDealtRound === ctx.st.round - 1) !== c.userDealtDamageLastRound) return false;
  if (c.userUsedAllTechniques !== undefined && u.creature.equippedTechniques.every((id) => (u.techUses[id] ?? 0) > 0) !== c.userUsedAllTechniques) return false;
  const costs = u.creature.equippedTechniques.map((id) => ctx.data.techniques.get(id)?.bondCost ?? 0);
  if (c.userEquipMaxCostAtMost !== undefined && !costs.every((x) => x <= c.userEquipMaxCostAtMost!)) return false;
  if (c.userEquipCostAtLeast && costs.filter((x) => x >= c.userEquipCostAtLeast!.cost).length < c.userEquipCostAtLeast.count) return false;
  if (c.environmentIs && !(ctx.st.environment && c.environmentIs.includes(ctx.st.environment.id))) return false;
  if (c.environmentIsNot && ctx.st.environment && c.environmentIsNot.includes(ctx.st.environment.id)) return false;
  if (c.choice !== undefined && s.choice !== c.choice) return false;
  if (c.minHitsOnTarget !== undefined && (s.hitsOnTarget ?? 0) < c.minHitsOnTarget) return false;
  if (c.techniquePhase !== undefined && s.phase !== c.techniquePhase) return false;
  if (c.hpCrossedBelowPct !== undefined) {
    const limit = (s.subject.maxHp * c.hpCrossedBelowPct) / 100;
    if (!(s.hpBefore !== undefined && s.hpBefore >= limit && s.subject.hp < limit)) return false;
  }
  if (c.subjectHpFull !== undefined && (s.subject.hp === s.subject.maxHp) !== c.subjectHpFull) return false;
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
    if (e.ops.some((o) => o.op === 'disableManifestations') && evalCondition(ctx, e.condition, { subject: c })) {
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

export interface AuraEffect {
  effect: Effect;
  source: string;
  carrier: Combatant | null;
}

// Efectos de Manifestaciones activas (propias o de otras criaturas presentes) y del Clima/Campo que alcanzan a `subject`
export function auras(ctx: EngineCtx, subject: Combatant, trigger: Trigger): AuraEffect[] {
  const out: AuraEffect[] = [];
  for (const carrier of allCombatants(ctx.st)) {
    if (carrier.location !== 'field') continue;
    for (const m of activeManifestations(ctx, carrier)) {
      // Los Climas/Campos solo actuan mientras estan activos, via ctx.st.environment
      if (m.override?.effects?.some((e) => e.ops.some((o) => o.op === 'setEnvironment'))) continue;
      for (const e of m.override?.effects ?? []) {
        if (e.trigger !== trigger) continue;
        const reaches =
          e.target === 'self' ? carrier === subject
          : e.target === 'all_allies' ? carrier.side === subject.side && subject.location === 'field'
          : e.target === 'other_allies' ? carrier.side === subject.side && carrier !== subject && subject.location === 'field'
          : e.target === 'all_enemies' ? carrier.side !== subject.side && subject.location === 'field'
          : e.target === 'all_present' ? subject.location === 'field'
          : false;
        if (reaches) out.push({ effect: e, source: m.id, carrier });
      }
    }
  }
  const envTrigger: Trigger = trigger === 'passive' ? 'environment' : trigger;
  const envId = ctx.st.environment?.id ?? '';
  for (const e of environmentEffects(ctx, envTrigger)) if (e.target === 'all_present') out.push({ effect: e, source: envId, carrier: null });
  return out;
}

export function auraOps(ctx: EngineCtx, subject: Combatant, kind: string, scope: EvalScope, trigger: Trigger = 'passive') {
  const out: { op: Effect['ops'][number]; source: string; carrier: Combatant | null }[] = [];
  for (const a of auras(ctx, subject, trigger)) {
    if (!evalCondition(ctx, a.effect.condition, { ...scope, subject })) continue;
    for (const o of a.effect.ops) if (o.op === kind) out.push({ op: o, source: a.source, carrier: a.carrier });
  }
  return out;
}

// CANON-MECHANICS 21.3 con efectos laterales (Estela) y Manifestaciones que modifican estadisticas
export function statOf(ctx: EngineCtx, c: Combatant, key: Exclude<StatKey, 'hp'>, stageOverride?: number): number {
  const mods: DirectModifier[] = [...statusModifiers(ctx.data, c, key)];
  if (c.location === 'field') {
    for (const se of sideOf(ctx.st, c.side).sideEffects) {
      for (const m of se.mods) if (m.kind === 'stat' && m.stat === key) mods.push({ pct: m.pct, fromStatus: false, source: se.id });
    }
    for (const a of auraOps(ctx, c, 'modifyStat', { subject: c })) {
      if (a.op.stat === key || (a.op.stats as string[] | undefined)?.includes(key)) mods.push({ pct: Number(a.op.pct), fromStatus: false, source: a.source });
    }
  }
  return effectiveStat(c.stable[key], stageOverride ?? c.stages[key], mods);
}

export function speedOf(ctx: EngineCtx, c: Combatant): number {
  return statOf(ctx, c, 'spe');
}

export function marksOf(c: Combatant, kind: MarkKind): Mark[] {
  return c.marks.filter((m) => m.kind === kind);
}

export function removeMark(c: Combatant, mark: Mark): void {
  c.marks = c.marks.filter((m) => m !== mark);
}

export type ExpirySpec = 'exit' | 'next_action' | 'end_of_round' | 'end_of_next_round' | { rounds: number; fromNext?: boolean } | { turns: number };

export function toExpiry(ctx: EngineCtx, spec: ExpirySpec | undefined): Expiry {
  if (spec === undefined || spec === 'exit') return { kind: 'exit' };
  if (spec === 'next_action') return { kind: 'next_action' };
  if (spec === 'end_of_round') return { kind: 'end_of_round', round: ctx.st.round };
  if (spec === 'end_of_next_round') return { kind: 'end_of_round', round: ctx.st.round + 1 };
  if ('rounds' in spec) return { kind: 'rounds', left: spec.rounds + (spec.fromNext ? 1 : 0) };
  return { kind: 'turns', left: spec.turns };
}

export function addMark(ctx: EngineCtx, owner: Combatant, mark: Mark, cause?: number): void {
  if (mark.evasion && ctx.st.field.revelationRounds > 0) {
    emit(ctx.st, { type: 'mark_blocked', actor: mark.by, targets: [owner.uid], data: { source: mark.source, reason: 'Revelacion absoluta' }, cause });
    return;
  }
  // GAP-HEAL-MODS: una marca del mismo tipo y origen sustituye a la anterior
  owner.marks = owner.marks.filter((m) => !(m.kind === mark.kind && m.source === mark.source));
  owner.marks.push(mark);
  emit(ctx.st, { type: 'mark', actor: mark.by, targets: [owner.uid], data: { kind: mark.kind, source: mark.source, expires: mark.expires, params: mark.params }, cause });
}

function restrictionFor(ctx: EngineCtx, c: Combatant, stat: StageKey): StatusId | null {
  for (const s of c.statuses) {
    const def = ctx.data.statuses.get(s.id);
    const r = def?.restrictions.find((x: StatusRestriction) => x.kind === 'stat_cannot_increase' && x.stat === stat);
    if (r && (s.counters.stat_cannot_increase ?? 0) > 0) return s.id;
  }
  return null;
}

// CANON-MECHANICS 21.2 / 24.4-24.7: etapas limitadas a [-6,+6]; ciertos estados impiden subir
export function changeStage(ctx: EngineCtx, c: Combatant, stat: StageKey, delta: number, source: string, cause?: number, ignoreRestrictions = false): number {
  if (c.location !== 'field' || delta === 0) return 0;
  const invert = auraOps(ctx, c, 'invertStages', { subject: c })[0];
  if (invert) {
    emit(ctx.st, { type: 'stage_inverted', targets: [c.uid], data: { stat, delta, source: invert.source }, cause });
    delta = -delta;
  }
  if (delta > 0 && !ignoreRestrictions) {
    const blocked = restrictionFor(ctx, c, stat);
    if (blocked) {
      emit(ctx.st, { type: 'stage_blocked', targets: [c.uid], data: { stat, delta, source, status: blocked }, cause, ruleRef: 'CANON-MECHANICS 24' });
      return 0;
    }
  }
  const from = c.stages[stat];
  const to = clampStage(from + delta);
  c.stages[stat] = to;
  const ev = emit(ctx.st, { type: 'stage', targets: [c.uid], data: { stat, from, to, delta, source }, cause, ruleRef: 'CANON-MECHANICS 21.2' });
  if (to < from) runAuras(ctx, c, 'on_stat_lowered', { cause: ev });
  return to - from;
}

// GAP-HEAL-MODS: estado mas severo + marca negativa mas severa + positivas + Manifestaciones del receptor y del sanador
export function healingFactor(ctx: EngineCtx, c: Combatant, healer?: Combatant | null): { factor: number; parts: DirectModifier[] } {
  const parts: DirectModifier[] = [];
  const statusWorst = Math.min(0, ...c.statuses.map((s) => ctx.data.statuses.get(s.id)?.statModifiersPct.healingReceived ?? 0));
  if (statusWorst < 0) parts.push({ pct: statusWorst, fromStatus: true, source: 'estado' });
  const markPcts = marksOf(c, 'healing_mod').map((m) => Number(m.params.pct));
  const markWorst = Math.min(0, ...markPcts);
  if (markWorst < 0) parts.push({ pct: markWorst, fromStatus: false, source: 'marca' });
  for (const p of markPcts.filter((x) => x > 0)) parts.push({ pct: p, fromStatus: false, source: 'marca' });
  for (const se of sideOf(ctx.st, c.side).sideEffects) for (const m of se.mods) if (m.kind === 'healing') parts.push({ pct: m.pct, fromStatus: false, source: se.id });
  for (const a of auraOps(ctx, c, 'modifyHealing', { subject: c })) if ((a.op.role ?? 'received') === 'received') parts.push({ pct: Number(a.op.pct), fromStatus: false, source: a.source });
  if (healer && healer.location !== 'defeated') {
    for (const a of auraOps(ctx, healer, 'modifyHealing', { subject: healer, target: c })) if (a.op.role === 'given') parts.push({ pct: Number(a.op.pct), fromStatus: false, source: a.source });
  }
  const sum = parts.reduce((a, b) => a + b.pct, 0);
  return { factor: Math.max(0, 1 + sum / 100), parts };
}

export function heal(ctx: EngineCtx, c: Combatant, base: number, source: string, cause?: number, partialUser = false, healer?: Combatant | null, fromZero = false): number {
  if (c.location !== 'field' && !(partialUser && c.location === 'intermedio')) return 0;
  if (c.hp <= 0 && !fromZero) return 0;
  const { factor, parts } = healingFactor(ctx, c, healer);
  const amount = Math.max(0, Math.round(base * factor));
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + amount);
  emit(ctx.st, { type: 'heal', targets: [c.uid], data: { source, base, factor, modifiers: parts, healed: c.hp - before, before, after: c.hp, gap: 'GAP-HEAL-MODS' }, cause, ruleRef: 'CANON-MECHANICS 23.5' });
  return c.hp - before;
}

// CANON-MECHANICS 28.5.15: respuestas por cruzar un umbral antes de comprobar la Derrota
export function afterHpLoss(ctx: EngineCtx, c: Combatant, before: number, cause?: number): void {
  if (c.hp >= before) return;
  runAuras(ctx, c, 'on_hp_threshold', { cause, hpBefore: before });
}

export function loseHp(ctx: EngineCtx, c: Combatant, amount: number, source: string, cause?: number, kind = 'self_damage', partialUser = false): number {
  if ((c.location !== 'field' && !(partialUser && c.location === 'intermedio')) || c.hp <= 0) return 0;
  const loss = Math.min(c.hp, Math.max(0, Math.round(amount)));
  const before = c.hp;
  c.hp -= loss;
  if (loss > 0) c.damagedThisRound = true;
  const ev = emit(ctx.st, { type: kind, targets: [c.uid], data: { source, loss, before, after: c.hp }, cause });
  afterHpLoss(ctx, c, before, ev);
  return loss;
}

export function lowestAlly(ctx: EngineCtx, side: SideIndex, exclude?: Combatant): Combatant | null {
  const allies = sideOf(ctx.st, side).combatants.filter((c) => c.location === 'field' && c !== exclude);
  // GAP-LOWEST-ALLY: menor porcentaje de Vitalidad; empate por orden de Preparacion
  return allies.reduce<Combatant | null>((best, c) => (!best || pctHp(c) < pctHp(best) ? c : best), null);
}

export function fieldCombatants(ctx: EngineCtx): Combatant[] {
  return allCombatants(ctx.st).filter((c) => c.location === 'field');
}
