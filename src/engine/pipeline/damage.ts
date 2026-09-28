import type { Technique } from '../../data/schema.js';
import type { Combatant, Mark } from '../model/battle.js';
import type { Op } from '../effects/dsl.js';
import type { TypeId } from '../model/types.js';
import { finalAccuracy } from '../rules/accuracy.js';
import { rawDamage } from '../rules/combat.js';
import { effectiveStat } from '../rules/stats.js';
import { auraOps, auras, evalCondition, marksOf, statOf, type EvalScope } from '../effects/runtime.js';
import { sideOf, type EngineCtx } from './context.js';
import { accuracyModifiers } from './combatant.js';

export interface DamageModifier {
  pct: number;
  source: string;
}

export interface HitScope extends EvalScope {
  user: Combatant;
  target: Combatant;
  technique: Technique;
  redirectPct?: number;
  attackOverride?: number;
  bonuses: DamageModifier[];
  consumed: Set<Mark>;
}

export function techniquePassiveOps(ctx: EngineCtx, t: Technique, scope: EvalScope, kind: Op['op']): Op[] {
  return (t.override?.effects ?? [])
    .filter((e) => e.trigger === 'passive' && evalCondition(ctx, e.condition, scope))
    .flatMap((e) => e.ops.filter((o) => o.op === kind));
}

// Bonificaciones de "la siguiente tecnica ... despues de entrar": una vez por Entrada
export function oncePerEntryBonuses(ctx: EngineCtx, t: Technique, user: Combatant, partial: boolean): DamageModifier[] {
  if (partial) return [];
  const out: DamageModifier[] = [];
  for (const a of auras(ctx, user, 'passive')) {
    if (a.carrier !== user || user.entryBonusesUsed.includes(a.source)) continue;
    if (!evalCondition(ctx, a.effect.condition, { subject: user, user, technique: t })) continue;
    for (const o of a.effect.ops) if (o.op === 'modifyDamage' && o.oncePerEntry) out.push({ pct: Number(o.pct), source: a.source });
  }
  return out;
}

export function isContact(ctx: EngineCtx, t: Technique): boolean {
  return t.override?.contact ?? (ctx.st.config.contactDefault === 'physical' && t.class === 'physical');
}

export interface HitCalc {
  attack: number;
  defense: number;
  typeMult: number;
  mods: DamageModifier[];
  halvings: number;
  ignoreDefense: boolean;
  raw: number;
  damageTakenMarks: Mark[];
  consumedSideEffects: string[];
}

// CANON-MECHANICS 23.1-23.4 con todos los modificadores de tecnica, Manifestacion, Clima, marcas y efectos laterales
export function computeHit(ctx: EngineCtx, h: HitScope, perHit: number): HitCalc {
  const { technique: t, user, target } = h;
  const physical = t.class === 'physical';
  const ops = (kind: Op['op']) => techniquePassiveOps(ctx, t, h, kind);

  const atkOp = ops('attackStat')[0];
  let attack: number;
  if (h.attackOverride !== undefined) attack = effectiveStat(h.attackOverride, user.stages.atk, []);
  else if (atkOp?.from === 'target' && atkOp.stat === 'highest_attack') attack = Math.max(statOf(ctx, target, 'atk'), statOf(ctx, target, 'matk'));
  else if (atkOp) attack = statOf(ctx, user, atkOp.stat as 'def' | 'mdef' | 'spe' | 'atk' | 'matk');
  else attack = statOf(ctx, user, physical ? 'atk' : 'matk');

  const defKey = physical ? 'def' : 'mdef';
  const undermine = marksOf(target, 'undermine').find((m) => m.params.byUid === user.uid);
  if (undermine) h.consumed.add(undermine);
  const ignoreOps = ops('ignoreDefense');
  const ignorePositive = ignoreOps.some((o) => o.positiveStagesOnly) || (!!undermine && defKey === 'def');
  let defense = statOf(ctx, target, defKey, ignorePositive ? Math.min(0, target.stages[defKey]) : undefined);
  for (const o of ignoreOps) if (typeof o.pct === 'number') defense = Math.max(1, defense * (1 - o.pct / 100));
  const ignoreDefense = ignoreOps.some((o) => o.pct === undefined && !o.positiveStagesOnly);

  const scopeU: EvalScope = { ...h, subject: user };
  const scopeT: EvalScope = { ...h, subject: target };
  const tOps = [...ops('typeOverride'), ...(h.partial ? [] : auraOps(ctx, user, 'typeOverride', scopeU).map((a) => a.op).filter((o) => o.role !== 'taken'))];
  const superVs = tOps.flatMap((o) => (o.superEffectiveVs as string[] | undefined) ?? []);
  const neutral = tOps.some((o) => o.neutralizeResistances);
  const capAdvantage = auraOps(ctx, target, 'typeOverride', scopeT).some((a) => a.op.role === 'taken' && a.op.capAdvantage);
  let typeMult = 1;
  if (t.type) {
    for (const d of target.creature.types) {
      let m = ctx.data.types.effectiveness[t.type][d as TypeId] ?? 1;
      if (superVs.includes(d)) m = 2;
      if (neutral && m < 1) m = 1;
      typeMult *= m;
    }
    if (capAdvantage) typeMult = Math.min(1, typeMult);
  }

  const mods: DamageModifier[] = [...h.bonuses];
  // GAP-INVARIANTE: si atacante u objetivo portan Invariante se ignoran los modificadores de dano del Clima/Campo
  const invariant = [user, target].some((c) => auraOps(ctx, c, 'ignoreEnvironmentDamage', { subject: c }).some((a) => a.carrier === c));
  const auraMods: DamageModifier[] = [];
  const collect = (subject: Combatant, role: 'dealt' | 'taken') => {
    for (const a of auraOps(ctx, subject, 'modifyDamage', subject === user ? scopeU : scopeT)) {
      if ((a.op.role ?? 'dealt') !== role || a.op.oncePerEntry || (!a.carrier && invariant)) continue;
      auraMods.push({ pct: Number(a.op.pct), source: a.source });
    }
  };
  if (!h.partial) collect(user, 'dealt');
  collect(target, 'taken');
  const cap = auraOps(ctx, user, 'capManifestationDamage', scopeU)[0];
  const positive = [...auraMods, ...h.bonuses].filter((m) => m.pct > 0).reduce((a, m) => a + m.pct, 0);
  if (cap && positive > Number(cap.op.max)) auraMods.push({ pct: Number(cap.op.max) - positive, source: `${cap.source}:limite` });
  mods.push(...auraMods);

  for (const o of ops('modifyDamage')) {
    if (typeof o.pctPerUserPositiveStage === 'number') {
      const stats = (o.stats as string[] | undefined) ?? Object.keys(user.stages);
      const n = stats.reduce((a, k) => a + Math.max(0, user.stages[k as keyof typeof user.stages] ?? 0), 0);
      if (n > 0) mods.push({ pct: o.pctPerUserPositiveStage * n, source: t.id });
    } else mods.push({ pct: Number(o.pct), source: t.id });
  }
  const streak = t.override?.streak;
  if (streak && user.streak?.techniqueId === t.id && user.streak.targetUid === target.uid) {
    // GAP-STREAK-FIRST: el primer uso no recibe bonificacion
    mods.push({ pct: Math.min(streak.max, streak.pct * user.streak.count), source: `${t.id}:racha` });
  }
  for (const m of marksOf(user, 'next_damage_bonus')) {
    const types = m.params.techniqueType as string[] | undefined;
    if (types && !(t.type && types.includes(t.type))) continue;
    mods.push({ pct: Number(m.params.pct), source: m.source });
    h.consumed.add(m);
  }
  if (h.redirectPct) mods.push({ pct: h.redirectPct, source: 'redireccion' });

  const damageTakenMarks: Mark[] = [];
  for (const m of marksOf(target, 'damage_taken')) {
    const classes = m.params.classes as string[] | undefined;
    if (classes && !classes.includes(t.class)) continue;
    mods.push({ pct: Number(m.params.pct), source: m.source });
    damageTakenMarks.push(m);
  }

  const ignoreBarriers = ops('ignoreBarriers').length > 0 || !!undermine;
  let halvings = auraOps(ctx, target, 'divideDamage', scopeT).length;
  const consumedSideEffects: string[] = [];
  for (const se of sideOf(ctx.st, target.side).sideEffects) {
    if (se.barrier && ignoreBarriers) continue;
    for (const m of se.mods) {
      if (m.kind !== 'damage_taken' && m.kind !== 'halve') continue;
      if (m.classes && !m.classes.includes(t.class)) continue;
      if (m.kind === 'halve') halvings++;
      else mods.push({ pct: m.pct, source: se.id });
      if (m.kind === 'damage_taken' && m.consume) consumedSideEffects.push(se.id);
    }
  }

  const raw = rawDamage({ power: perHit, attack, defense, damagePcts: mods.map((m) => m.pct), typeMult, halvings, ignoreDefense });
  return { attack, defense, typeMult, mods, halvings, ignoreDefense, raw, damageTakenMarks, consumedSideEffects };
}

export interface AccuracyCalc {
  accuracy: number;
  bypassDodge: boolean;
  sources: string[];
}

// CANON-MECHANICS 20.1-20.3
export function computeAccuracy(ctx: EngineCtx, h: HitScope): AccuracyCalc {
  const { technique: t, user, target } = h;
  const base = typeof t.accuracy === 'number' ? t.accuracy : t.override?.accuracyAssumed ?? 100;
  const fromStatus = accuracyModifiers(ctx.data, user);
  const rel = [...fromStatus.relativePct];
  const pp = [...fromStatus.percentagePoints];
  const sources: string[] = [];
  let neverMiss = t.override?.neverMiss === true;
  let ignoreReductions = false;
  const sure = marksOf(target, 'sure_hit').find((m) => m.params.byUid === user.uid || (m.params.anyAlly && m.params.bySide === user.side));
  if (sure) {
    h.consumed.add(sure);
    neverMiss = true;
    sources.push(sure.source);
  }
  const accOps = [
    ...(h.partial ? [] : auraOps(ctx, user, 'modifyAccuracy', { ...h, subject: user })),
    ...techniquePassiveOps(ctx, t, { ...h, subject: user }, 'modifyAccuracy').map((op) => ({ op, source: t.id })),
  ];
  const ignoreEvasion = accOps.some((a) => a.op.ignoreEvasion);
  for (const m of marksOf(user, 'outgoing_accuracy')) {
    rel.push(Number(m.params.pct));
    sources.push(m.source);
    h.consumed.add(m);
  }
  if (target.side !== user.side) {
    for (const m of marksOf(target, 'incoming_accuracy')) {
      if (ignoreEvasion && (m.evasion || Number(m.params.pct) < 0)) continue;
      rel.push(Number(m.params.pct));
      sources.push(m.source);
      h.consumed.add(m);
    }
  }
  for (const { op: o, source } of accOps) {
    if (o.neverMiss) neverMiss = true;
    if (o.ignoreReductions) ignoreReductions = true;
    if (typeof o.pct === 'number') rel.push(o.pct);
    if (typeof o.pp === 'number') pp.push(o.pp);
    sources.push(source);
  }
  const keep = (xs: number[]) => (ignoreReductions ? xs.filter((x) => x > 0) : xs);
  return { accuracy: finalAccuracy(base, { relativePct: keep(rel), percentagePoints: keep(pp) }, neverMiss), bypassDodge: !!sure, sources };
}
