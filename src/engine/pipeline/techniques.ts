import type { Technique } from '../../data/schema.js';
import type { Combatant, Mark, Position, TargetDecl } from '../model/battle.js';
import type { Effect, Op } from '../effects/dsl.js';
import { emit } from '../log/events.js';
import { nextInt } from '../rng.js';
import { finalizeDamage } from '../rules/combat.js';
import { techniqueAvailability } from '../effects/availability.js';
import { afterHpLoss, auraOps, environmentEffects, loseHp, marksOf, removeMark } from '../effects/runtime.js';
import { runAuras, runEffects, type RunScope } from '../effects/interpreter.js';
import { findPosition, occupantOf, roll, sideOf, type EngineCtx } from './context.js';
import { applyStatus } from './combatant.js';
import { exitField, forcedReplacement, performSelfSwitch } from './lifecycle.js';
import { computeAccuracy, computeHit, isContact, oncePerEntryBonuses, type DamageModifier, type HitScope } from './damage.js';
import { stableStat } from '../rules/stats.js';
import { hordeBodies, hordeHitPlan, HORDE_CORPSE_DAMAGE_PCT, presentCorpses } from '../rules/horde.js';

export function rollHits(ctx: Pick<EngineCtx, 'st'>, min: number, max: number): number {
  if (min === max) return min;
  if (ctx.st.config.multiHitDistribution === 'uniform') return nextInt(ctx.st.rng, min, max);
  const k = max - min + 1;
  let r = nextInt(ctx.st.rng, 1, (k * (k + 3)) / 2);
  for (let i = 0; i < k; i++) {
    r -= k + 1 - i;
    if (r <= 0) return min + i;
  }
  return max;
}

function hitCount(ctx: EngineCtx, t: Technique, user: Combatant, partial: boolean, cause: number): number {
  const h = t.power?.hits ?? { min: 1, max: 1 };
  // GAP-SOBRECARGA: toda tecnica de mas de un impacto realiza como minimo n impactos
  const floor = h.max > 1 && !partial ? auraOps(ctx, user, 'minHits', { subject: user, user, technique: t })[0] : undefined;
  const n = rollHits(ctx, h.min, h.max);
  const total = floor ? Math.max(n, Number(floor.op.n)) : n;
  if (h.min !== h.max || total !== n) {
    emit(ctx.st, { type: 'hit_count', data: { technique: t.id, hits: total, min: h.min, max: h.max, rolled: h.min === h.max ? undefined : n, minimumFrom: total !== n ? floor?.source : undefined, gap: 'GAP-MULTIHIT-DIST' }, cause, ruleRef: 'CANON-MECHANICS 19.4' });
  }
  return total;
}

function autoTargets(ctx: EngineCtx, t: Technique, user: Combatant): Position[] {
  const set = t.override?.targetSet ?? 'all_enemies';
  const own = sideOf(ctx.st, user.side).positions;
  const foe = sideOf(ctx.st, user.side === 0 ? 1 : 0).positions;
  const pool = set === 'all_allies' ? own : set === 'all_present' ? [...own, ...foe] : foe;
  return pool.filter((p) => p.occupantUid !== null);
}

interface TechRun {
  t: Technique;
  user: Combatant;
  partial: boolean;
  choice?: string;
  phase: number;
  charged: boolean;
  attackOverride?: number;
  cause: number;
  bonuses: DamageModifier[];
  impacted: Combatant[];
  damageDealt: number;
  primaryCalculated: number | null;
  consumed: Set<Mark>;
  anyImpact: boolean;
}

// Punto unico para registrar Derrotas; los Reemplazos esperan a terminar la tecnica (19.4)
export function defeatIfZero(ctx: EngineCtx, c: Combatant, cause?: number): void {
  if (c.hp > 0) return;
  if (c.location === 'field') {
    c.hp = 0;
    const pid = c.positionId!;
    exitField(ctx, c, 'defeat', cause);
    (ctx.pendingReplacements ??= []).push(pid);
  } else if (c.location === 'intermedio') {
    c.location = 'defeated';
    emit(ctx.st, { type: 'defeat', actor: c.uid, data: { kind: 'defeat', partial: true }, cause, ruleRef: 'CANON-MECHANICS 26.1' });
  }
}

// GAP-EMPTY-TARGET: si la posicion declarada esta vacia, el impacto pasa a la otra posicion ocupada de ese mismo lado
function targetAt(ctx: EngineCtx, pos: Position, techniqueId: string, user: Combatant, hitIndex: number, cause: number): Combatant | null {
  const occ = occupantOf(ctx.st, pos.id);
  if (occ) return occ;
  const alt = sideOf(ctx.st, pos.side).positions.find((p) => p.id !== pos.id && p.occupantUid !== null);
  if (!alt) {
    emit(ctx.st, { type: 'hit_no_target', actor: user.uid, targets: [pos.id], data: { technique: techniqueId, hitIndex, gap: 'GAP-EMPTY-TARGET' }, cause, ruleRef: 'CANON-MECHANICS 14.2' });
    return null;
  }
  const target = occupantOf(ctx.st, alt.id)!;
  emit(ctx.st, { type: 'retargeted', actor: user.uid, targets: [target.uid], data: { technique: techniqueId, from: pos.id, to: alt.id, hitIndex, gap: 'GAP-EMPTY-TARGET' }, cause, ruleRef: 'CANON-MECHANICS 14.2' });
  return target;
}

function redirectTarget(ctx: EngineCtx, t: Technique, user: Combatant, target: Combatant, single: boolean): { target: Combatant; pct: number } | null {
  if (!single || t.class === 'status' || target.side === user.side) return null;
  const guard = sideOf(ctx.st, target.side).combatants.find((c) => c !== target && c.location === 'field' && marksOf(c, 'redirect').length > 0);
  if (!guard) return null;
  return { target: guard, pct: Number(marksOf(guard, 'redirect')[0]!.params.pct ?? 0) };
}

function onDamageTaken(ctx: EngineCtx, run: TechRun, target: Combatant, marks: Mark[], loss: number, cause: number): void {
  for (const m of marks) {
    const scope: RunScope = { subject: target, source: m.source, sourceKind: 'mark', cause };
    if (m.params.reflectPct) loseHp(ctx, run.user, (loss * Number(m.params.reflectPct)) / 100, m.source, cause, 'reflect');
    if (m.params.storeEnergy) {
      target.marks.push({ kind: 'stored_energy', source: m.source, by: target.uid, expires: { kind: 'exit' }, params: { tag: 'stored_energy', clearOnTechniqueExcept: m.params.storeEnergy } });
      emit(ctx.st, { type: 'mark', targets: [target.uid], data: { kind: 'stored_energy', source: m.source }, cause });
    }
    const onHit = m.params.onHit as Op[] | undefined;
    if (onHit) runEffects(ctx, [{ trigger: 'on_damage_taken', target: 'self', ops: onHit }], 'on_damage_taken', scope);
    const onSurvive = m.params.onSurvive as Op[] | undefined;
    if (onSurvive && target.hp > 0) runEffects(ctx, [{ trigger: 'on_damage_taken', target: 'self', ops: onSurvive }], 'on_damage_taken', scope);
    if (m.params.consume) removeMark(target, m);
  }
}

// CANON-MECHANICS 28.5.15: precision, calculo sin redondeo intermedio, perdida real, respuestas de supervivencia
function resolveHit(ctx: EngineCtx, run: TechRun, pos: Position, hitIndex: number, single: boolean, primary: boolean): boolean {
  const { t, user, cause } = run;
  let target = targetAt(ctx, pos, t.id, user, hitIndex, cause);
  if (!target) return false;
  const redirect = redirectTarget(ctx, t, user, target, single);
  if (redirect) {
    emit(ctx.st, { type: 'redirected', actor: user.uid, targets: [redirect.target.uid], data: { from: target.uid, technique: t.id }, cause });
    target = redirect.target;
  }
  return resolveHitOn(ctx, run, target, hitIndex, primary, redirect?.pct);
}

function resolveHitOn(ctx: EngineCtx, run: TechRun, target: Combatant, hitIndex: number, primary: boolean, redirectPct?: number, perHitOverride?: number): boolean {
  const { t, user, cause } = run;
  const h: HitScope = { subject: user, user, target, technique: t, partial: run.partial, choice: run.choice, phase: run.phase, charged: run.charged, attackOverride: run.attackOverride, bonuses: run.bonuses, consumed: run.consumed, redirectPct };
  const acc = computeAccuracy(ctx, h);
  if (target.dodgingThisRound && target.side !== user.side && !acc.bypassDodge) {
    emit(ctx.st, { type: 'dodged', actor: user.uid, targets: [target.uid], data: { technique: t.id, hitIndex }, cause, ruleRef: 'CANON-MECHANICS 17' });
    return false;
  }
  const r = roll(ctx, `accuracy:${t.id}#${hitIndex}`, acc.accuracy);
  if (!r.result) {
    emit(ctx.st, { type: 'miss', actor: user.uid, targets: [target.uid], data: { technique: t.id, hitIndex, accuracy: acc.accuracy, sources: acc.sources }, rolls: [r], cause, ruleRef: 'CANON-MECHANICS 20' });
    return false;
  }
  run.impacted.push(target);
  run.anyImpact = true;
  const rolls = r.roll === null ? undefined : [r];
  if (t.class === 'status') {
    emit(ctx.st, { type: 'impact', actor: user.uid, targets: [target.uid], data: { technique: t.id, hitIndex }, rolls, cause, ruleRef: 'CANON-MECHANICS 19.3' });
    return false;
  }
  const calc = computeHit(ctx, h, perHitOverride ?? (t.power!.perHit as number));
  const share = sharedDamageCarrier(ctx, target);
  const out = finalizeDamage(share ? calc.raw / 2 : calc.raw, target.maxHp, target.hp);
  let loss = out.loss;
  const survival = loss > 0 && loss >= target.hp && target.hp === target.maxHp
    ? auraOps(ctx, target, 'survivesAt1Hp', { subject: target, user, target, technique: t }, 'would_be_defeated')[0]
    : undefined;
  if (survival) loss = target.hp - 1;
  const before = target.hp;
  target.hp -= loss;
  if (primary && run.primaryCalculated === null) run.primaryCalculated = out.calculated;
  if (loss > 0) {
    target.damagedThisRound = true;
    user.lastDamageDealtRound = ctx.st.round;
    run.damageDealt += loss;
  }
  const dmgEv = emit(ctx.st, {
    type: 'damage',
    actor: user.uid,
    targets: [target.uid],
    data: {
      technique: t.id, hitIndex, attack: calc.attack, defense: calc.defense, typeMult: calc.typeMult, modifiers: calc.mods, halvings: calc.halvings,
      ignoreDefense: calc.ignoreDefense, raw: out.raw, calculated: out.calculated, loss, before, after: target.hp,
      sharedWith: share?.uid, attackParts: calc.attackParts, defenseParts: calc.defenseParts,
    },
    rolls,
    cause,
    ruleRef: 'CANON-MECHANICS 23',
  });
  if (survival) emit(ctx.st, { type: 'survived', targets: [target.uid], data: { source: survival.source, hp: target.hp }, cause: dmgEv, ruleRef: 'CANON-MECHANICS 28.5.15' });
  if (calc.consumedSideEffects.length) {
    const side = sideOf(ctx.st, target.side);
    side.sideEffects = side.sideEffects.filter((x) => !calc.consumedSideEffects.includes(x.id));
    for (const id of calc.consumedSideEffects) emit(ctx.st, { type: 'side_effect_destroyed', targets: [], data: { side: side.index, id, consumed: true }, cause: dmgEv });
  }
  if (share) {
    // GAP-RAIZ: la mitad del dano calculado se transfiere al portador reducida a la mitad
    loseHp(ctx, share, calc.raw / 4, 'raiz_compartida', dmgEv, 'shared_damage');
    defeatIfZero(ctx, share, dmgEv);
  }
  onDamageTaken(ctx, run, target, calc.damageTakenMarks, loss, dmgEv);
  afterHpLoss(ctx, target, before, dmgEv);
  const wasField = target.location === 'field';
  defeatIfZero(ctx, target, dmgEv);
  return wasField && target.location === 'defeated';
}

function sharedDamageCarrier(ctx: EngineCtx, target: Combatant): Combatant | null {
  if (target.location !== 'field') return null;
  return sideOf(ctx.st, target.side).combatants.find((c) => c !== target && c.location === 'field' && auraOps(ctx, c, 'shareDamage', { subject: c }).some((a) => a.carrier === c)) ?? null;
}

function positionsForTarget(ctx: EngineCtx, target: TargetDecl): Position[] {
  const ids = target.kind === 'position' ? [target.positionId] : target.kind === 'auto' ? [] : target.positionIds;
  return ids.map((id) => findPosition(ctx.st, id)).filter((p): p is Position => p !== undefined);
}

// Marcas reactivas del objetivo al recibir la tecnica (contacto, "si recibe una tecnica")
function reactToTechnique(ctx: EngineCtx, run: TechRun, target: Combatant): void {
  if (target.side === run.user.side || target.location !== 'field') return;
  for (const m of marksOf(target, 'retaliate_contact')) {
    if (!isContact(ctx, run.t)) continue;
    const ev = emit(ctx.st, { type: 'retaliation', actor: target.uid, targets: [run.user.uid], data: { source: m.source, technique: run.t.id, gap: 'GAP-CONTACT' }, cause: run.cause });
    loseHp(ctx, run.user, (run.user.maxHp * Number(m.params.pctMaxHp)) / 100, m.source, ev, 'retaliation_damage');
    if (m.params.status && run.user.location === 'field') {
      const r = roll(ctx, `retaliation:${m.source}`, Number(m.params.statusChance ?? 100));
      if (r.result) {
        const res = applyStatus(ctx.data, run.user, m.params.status as never);
        emit(ctx.st, { type: res === 'applied' ? 'status_applied' : res === 'immune' ? 'status_immune' : 'status_already_present', actor: target.uid, targets: [run.user.uid], data: { status: m.params.status, source: m.source }, rolls: r.roll === null ? undefined : [r], cause: ev });
      }
    }
    defeatIfZero(ctx, run.user, ev);
  }
  for (const m of marksOf(target, 'reactive')) {
    removeMark(target, m);
    runEffects(ctx, [{ trigger: 'on_damage_taken', target: 'self', ops: m.params.ops as Op[] }], 'on_damage_taken', { subject: target, source: m.source, sourceKind: 'mark', cause: run.cause });
  }
  runAuras(ctx, target, 'on_technique_received', { user: run.user, technique: run.t, cause: run.cause });
}

export function executeTechnique(ctx: EngineCtx, t: Technique, user: Combatant, target: TargetDecl, cause: number, partial = false, choice?: string): void {
  const a = techniqueAvailability(t, ctx.st.config.effectsMode);
  if (a.baseOnly && a.status === 'uncurated') emit(ctx.st, { type: 'warning', actor: user.uid, data: { technique: t.id, message: a.reason }, cause });
  const ov = t.override;
  const effects = ov?.effects ?? [];
  const phase = ov?.phases ? ((user.techUses[t.id] ?? 0) % ov.phases) + 1 : 1;
  ctx.inTechnique = (ctx.inTechnique ?? 0) + 1;
  // Ultimo recurso y similares se evaluan con los usos previos a esta tecnica
  const bonuses = oncePerEntryBonuses(ctx, t, user, partial);
  user.techUses[t.id] = (user.techUses[t.id] ?? 0) + 1;
  if (!partial && user.committedTechnique === null) user.committedTechnique = t.id;
  for (const m of marksOf(user, 'priority_mod')) removeMark(user, m);
  // Energia de Cristal opaco: se pierde al usar cualquier otra tecnica que no la consuma
  user.marks = user.marks.filter((m) => m.params.clearOnTechniqueExcept === undefined || m.params.clearOnTechniqueExcept === t.id);
  const charged = !!ov?.charge;
  const scope: RunScope = { subject: user, user, technique: t, partial, choice, phase, charged, source: t.id, sourceKind: 'technique', cause };

  if (runEffects(ctx, effects, 'on_use', scope).failed) return finish(ctx, t, user, cause, null);

  for (const b of bonuses) {
    user.entryBonusesUsed.push(b.source);
    emit(ctx.st, { type: 'bonus_consumed', actor: user.uid, data: { manifestation: b.source, technique: t.id, pct: b.pct }, cause, ruleRef: 'CANON-MANIFESTATIONS' });
  }
  const run: TechRun = { t, user, partial, choice, phase, charged, cause, bonuses, impacted: [], damageDealt: 0, primaryCalculated: null, consumed: new Set(), anyImpact: false };
  const n = t.class === 'status' ? 1 : ov?.handler === 'horda' ? 0 : hitCount(ctx, t, user, partial, cause);
  const declared = positionsForTarget(ctx, target);
  const side = ov?.targetSide;
  const targeting = ov?.declareAs ?? t.targeting;
  // un usuario derrotado a mitad de tecnica (reflejo) no realiza mas impactos
  const active = () => user.location !== 'defeated';

  if (ov?.handler === 'horda') {
    hordeHits(ctx, run, declared);
  } else if (side === 'side') {
    // efecto de lado o de campo: sin impactos individuales
  } else if (side === 'self') {
    run.impacted.push(user);
    run.anyImpact = true;
    emit(ctx.st, { type: 'impact', actor: user.uid, targets: [user.uid], data: { technique: t.id, self: true }, cause });
  } else if (targeting === 'all') {
    for (let i = 0; i < n && active(); i++) for (const p of autoTargets(ctx, t, user)) if (active()) resolveHit(ctx, run, p, i, false, false);
  } else if (target.kind === 'perHit') {
    for (let i = 0; i < n && active(); i++) {
      const p = declared[Math.min(i, declared.length - 1)];
      if (!p) break;
      if (i >= declared.length) emit(ctx.st, { type: 'rule_gap', data: { gap: 'GAP-MULTI-OVERFLOW', hitIndex: i }, cause });
      resolveHit(ctx, run, p, i, false, false);
    }
  } else {
    // Objetivo unico: se detiene al derrotar; secuencia Multiobjetivo: pasa a la siguiente posicion declarada (19.4)
    let idx = 0;
    const single = targeting === 'single';
    for (let i = 0; i < n && idx < declared.length && active(); i++) if (resolveHit(ctx, run, declared[idx]!, i, single, i === 0)) idx++;
  }

  // GAP-SPLASH: la segunda criatura activa enemiga recibe un % del dano calculado contra el objetivo principal, sin efectos secundarios
  if (ov?.splashPct && run.primaryCalculated !== null) {
    const primary = run.impacted[0];
    const second = sideOf(ctx.st, user.side === 0 ? 1 : 0).combatants.find((c) => c.location === 'field' && c !== primary);
    if (second) {
      if (second.dodgingThisRound) emit(ctx.st, { type: 'dodged', actor: user.uid, targets: [second.uid], data: { technique: t.id, splash: true }, cause });
      else {
        const amount = Math.min(second.maxHp, Math.round((run.primaryCalculated * ov.splashPct) / 100));
        const loss = loseHp(ctx, second, amount, t.id, cause, 'splash_damage');
        if (loss > 0) run.damageDealt += loss;
        defeatIfZero(ctx, second, cause);
      }
    }
  }

  // CANON-MECHANICS 28.5.15: efectos secundarios antes de los Reemplazos; una vez por objetivo salvo flags.perHit
  const envOnHit = environmentEffects(ctx, 'on_hit');
  const envId = ctx.st.environment?.id ?? '';
  const distinct = [...new Set(run.impacted)];
  const hitsOn = (c: Combatant) => run.impacted.filter((x) => x === c).length;
  const once = (list: Effect[]) => list.filter((e) => !e.flags?.perHit);
  const each = (list: Effect[]) => list.filter((e) => e.flags?.perHit);
  for (const tg of distinct) {
    if (tg.location !== 'field') continue;
    runEffects(ctx, once(effects), 'on_hit', { ...scope, target: tg, hitsOnTarget: hitsOn(tg) });
    runEffects(ctx, once(envOnHit), 'on_hit', { subject: user, user, target: tg, technique: t, partial, source: envId, sourceKind: 'environment', cause });
  }
  for (const tg of run.impacted) {
    if (tg.location !== 'field') continue;
    runEffects(ctx, each(effects), 'on_hit', { ...scope, target: tg });
    runEffects(ctx, each(envOnHit), 'on_hit', { subject: user, user, target: tg, technique: t, partial, source: envId, sourceKind: 'environment', cause });
  }
  for (const tg of distinct) reactToTechnique(ctx, run, tg);

  // GAP-DAMAGE-DEALT: "tras causar dano" exige perdida real de Vitalidad > 0
  if (run.damageDealt > 0 && user.location === 'field') {
    runEffects(ctx, effects, 'after_damage', { ...scope, target: distinct[0], damageDealt: run.damageDealt });
    runAuras(ctx, user, 'after_damage', { user, technique: t, damageDealt: run.damageDealt, cause });
  }
  if (user.location === 'field' || partial) runEffects(ctx, effects, 'after_use', { ...scope, target: distinct[0], damageDealt: run.damageDealt });
  if (user.location === 'field' && !partial) runAuras(ctx, user, 'after_use', { user, technique: t, cause });
  defeatIfZero(ctx, user, cause);

  if (t.class !== 'status') user.lastDamagingMissed = !run.anyImpact;
  if (ov?.streak) {
    const tg = distinct[0];
    user.streak = tg && user.streak?.techniqueId === t.id && user.streak.targetUid === tg.uid ? { ...user.streak, count: user.streak.count + 1 } : tg ? { techniqueId: t.id, targetUid: tg.uid, count: 1 } : null;
  } else user.streak = null;
  for (const m of run.consumed) {
    for (const x of [...ctx.st.sides[0].combatants, ...ctx.st.sides[1].combatants]) if (x.marks.includes(m)) removeMark(x, m);
  }
  finish(ctx, t, user, cause, run);
}

function finish(ctx: EngineCtx, t: Technique, user: Combatant, cause: number, run: TechRun | null): void {
  if (!user.everUsed.includes(t.id)) user.everUsed.push(t.id);
  emit(ctx.st, { type: 'technique_end', actor: user.uid, data: { technique: t.id, damageDealt: run?.damageDealt ?? 0 }, cause, ruleRef: 'CANON-MECHANICS 19.4' });
  ctx.inTechnique = (ctx.inTechnique ?? 1) - 1;
  // CANON-MECHANICS 19.4 / 28.5: Reemplazos forzados solo al terminar la tecnica; despues los Intercambios forzados
  flushPending(ctx, cause);
}

// Derrotas producidas fuera de un impacto (perdidas por efectos, Climas, respuestas)
function sweepDefeats(ctx: EngineCtx, cause?: number): void {
  for (const side of ctx.st.sides) for (const c of side.combatants) if (c.location === 'field' && c.hp <= 0) defeatIfZero(ctx, c, cause);
}

// CANON-MECHANICS 10.10 / 16.5 / 16.6 / 28.5: la cadena se vacia en profundidad antes de seguir; dentro de una tecnica espera a que termine
export function flushPending(ctx: EngineCtx, cause?: number): void {
  if ((ctx.inTechnique ?? 0) > 0) return;
  for (;;) {
    sweepDefeats(ctx, cause);
    const pid = ctx.deferReplacements ? undefined : ctx.pendingReplacements?.shift();
    if (pid !== undefined) {
      resolveChain(ctx, () => forcedReplacement(ctx, pid, cause));
      continue;
    }
    const sw = ctx.selfSwitches?.shift();
    if (sw) {
      resolveChain(ctx, () => performSelfSwitch(ctx, sw), true);
      continue;
    }
    return;
  }
}

// Resuelve un eslabon y todas sus consecuencias antes que las consecuencias pendientes anteriores
export function resolveChain(ctx: EngineCtx, step: () => void, droppable = false): void {
  if ((ctx.inTechnique ?? 0) > 0) return step();
  const depth = (ctx.chainDepth ?? 0) + 1;
  if (depth > ctx.st.config.maxChainDepth) {
    // GAP-CHAIN-DEPTH: se cortan los Intercambios forzados en bucle; Reemplazos y Entradas siempre se resuelven
    if (droppable) {
      emit(ctx.st, { type: 'rule_gap', data: { gap: 'GAP-CHAIN-DEPTH', dropped: 'self_switch' }, ruleRef: 'CANON-MECHANICS 10.10' });
      return;
    }
    return step();
  }
  const saved = { r: ctx.pendingReplacements ?? [], s: ctx.selfSwitches ?? [] };
  ctx.pendingReplacements = [];
  ctx.selfSwitches = [];
  ctx.chainDepth = depth;
  try {
    step();
    flushPending(ctx);
  } finally {
    ctx.chainDepth = depth - 1;
    ctx.pendingReplacements = [...(ctx.pendingReplacements ?? []), ...saved.r];
    ctx.selfSwitches = [...(ctx.selfSwitches ?? []), ...saved.s];
  }
}

// CANON-TECHNIQUES Horda: cada golpe usa el Ataque y una tecnica anatomica de un cadaver (los descriptores se reutilizan en ciclo)
function hordeHits(ctx: EngineCtx, run: TechRun, declared: Position[]): void {
  const horde = hordeBodies(run.user.creature.horde ?? []);
  const unique = declared.filter((p, i) => declared.findIndex((q) => q.id === p.id) === i);
  const occupied = unique.filter((p) => !!occupantOf(ctx.st, p.id));
  const positions = occupied.length > 0 ? occupied : unique.slice(0, 1);
  const corpses = presentCorpses(run.user.colony, run.user.creature, run.partial);
  const plan = hordeHitPlan(corpses, positions.length);
  const total = plan.reduce((a, b) => a + b, 0);
  if (horde.length === 0 || total === 0) return;
  emit(ctx.st, { type: 'hit_count', actor: run.user.uid, data: { technique: run.t.id, hits: total, corpses, perTarget: plan, total: run.user.colony?.total, gap: 'GAP-HOLOMICOR-COLONY' }, cause: run.cause, ruleRef: 'CANON-TECHNIQUES Horda' });
  let k = 0;
  for (let ti = 0; ti < positions.length; ti++) {
    for (let j = 0; j < (plan[ti] ?? 0); j++, k++) {
      const corpse = horde[k % horde.length]!;
      const ct = ctx.data.techniques.get(corpse.techniqueId);
      if (!ct || run.user.location === 'defeated') return;
      const attack = stableStat(corpse.atkNV50, run.user.creature.nv);
      const ev = emit(ctx.st, { type: 'horde_corpse', actor: run.user.uid, data: { hitIndex: k, species: corpse.speciesId, technique: ct.id, attack, gap: 'GAP-HORDA' }, cause: run.cause, ruleRef: 'CANON-TECHNIQUES Horda' });
      const target = targetAt(ctx, positions[ti]!, ct.id, run.user, k, ev);
      if (!target) return;
      const sub: TechRun = { ...run, t: ct, cause: ev, attackOverride: attack, bonuses: [...run.bonuses, { pct: HORDE_CORPSE_DAMAGE_PCT, source: 'horda' }] };
      resolveHitOn(ctx, sub, target, k, k === 0, undefined, ct.power?.perHit as number);
      run.damageDealt = sub.damageDealt;
      run.anyImpact = sub.anyImpact;
      run.primaryCalculated = sub.primaryCalculated;
    }
  }
}
