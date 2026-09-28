import type { Technique } from '../../data/schema.js';
import type { Combatant, Position, TargetDecl } from '../model/battle.js';
import { emit, type RollRecord } from '../log/events.js';
import { nextInt } from '../rng.js';
import { finalAccuracy } from '../rules/accuracy.js';
import { finalizeDamage, rawDamage, typeMultiplier } from '../rules/combat.js';
import { techniqueAvailability } from '../effects/availability.js';
import { findPosition, occupantOf, sideOf, roll, type EngineCtx } from './context.js';
import { accuracyModifiers, effStat } from './combatant.js';
import { exitField, forcedReplacement } from './lifecycle.js';

function hitCount(ctx: EngineCtx, t: Technique, cause: number): number {
  const h = t.power?.hits ?? { min: 1, max: 1 };
  if (h.min === h.max) return h.min;
  const n = nextInt(ctx.st.rng, h.min, h.max);
  emit(ctx.st, { type: 'hit_count', data: { technique: t.id, hits: n, min: h.min, max: h.max, gap: 'GAP-MULTIHIT-DIST' }, cause, ruleRef: 'CANON-MECHANICS 19.4' });
  return n;
}

function autoTargets(ctx: EngineCtx, t: Technique, user: Combatant): Position[] {
  const set = t.override?.targetSet ?? 'all_enemies';
  const own = sideOf(ctx.st, user.side).positions;
  const foe = sideOf(ctx.st, user.side === 0 ? 1 : 0).positions;
  const pool = set === 'all_allies' ? own : set === 'all_present' ? [...own, ...foe] : foe;
  return pool.filter((p) => p.occupantUid !== null);
}

interface HitResult {
  defeatedPosition: string | null;
}

// CANON-MECHANICS 28.5.15: precision, calculo sin redondeo intermedio, perdida real, respuestas de supervivencia
function resolveHit(ctx: EngineCtx, t: Technique, user: Combatant, pos: Position, hitIndex: number, cause: number): HitResult {
  const target = occupantOf(ctx.st, pos.id);
  if (!target) {
    emit(ctx.st, { type: 'hit_no_target', actor: user.uid, targets: [pos.id], data: { technique: t.id, hitIndex, gap: 'GAP-EMPTY-TARGET' }, cause, ruleRef: 'CANON-MECHANICS 14.2' });
    return { defeatedPosition: null };
  }
  if (target.dodgingThisRound && target.side !== user.side) {
    emit(ctx.st, { type: 'dodged', actor: user.uid, targets: [target.uid], data: { technique: t.id, hitIndex }, cause, ruleRef: 'CANON-MECHANICS 17' });
    return { defeatedPosition: null };
  }
  const base = typeof t.accuracy === 'number' ? t.accuracy : 100;
  const acc = finalAccuracy(base, accuracyModifiers(ctx.data, user), t.override?.neverMiss === true);
  const r: RollRecord = roll(ctx, `accuracy:${t.id}#${hitIndex}`, acc);
  if (!r.result) {
    emit(ctx.st, { type: 'miss', actor: user.uid, targets: [target.uid], data: { technique: t.id, hitIndex, accuracy: acc }, rolls: [r], cause, ruleRef: 'CANON-MECHANICS 20' });
    return { defeatedPosition: null };
  }
  if (t.class === 'status') {
    emit(ctx.st, { type: 'technique_no_effect', actor: user.uid, targets: [target.uid], data: { technique: t.id, reason: 'tecnica de Estado sin efectos ejecutables' }, rolls: [r], cause, ruleRef: 'CANON-MECHANICS 19.3' });
    return { defeatedPosition: null };
  }
  const physical = t.class === 'physical';
  const attack = effStat(ctx.data, user, physical ? 'atk' : 'matk');
  const defense = effStat(ctx.data, target, physical ? 'def' : 'mdef');
  const typeMult = typeMultiplier(ctx.data.types, t.type, target.creature.types);
  const raw = rawDamage({ power: t.power!.perHit as number, attack, defense, damagePcts: [], typeMult, halvings: 0, ignoreDefense: false });
  const out = finalizeDamage(raw, target.maxHp, target.hp);
  const before = target.hp;
  target.hp -= out.loss;
  const dmgEv = emit(ctx.st, {
    type: 'damage',
    actor: user.uid,
    targets: [target.uid],
    data: { technique: t.id, hitIndex, attack, defense, typeMult, raw: out.raw, calculated: out.calculated, loss: out.loss, before, after: target.hp },
    rolls: [r],
    cause,
    ruleRef: 'CANON-MECHANICS 23',
  });
  // Punto de enganche de respuestas de supervivencia (fase 5); despues se recomprueba la Vitalidad
  if (target.hp <= 0) {
    target.hp = 0;
    exitField(ctx, target, 'defeat', dmgEv);
    return { defeatedPosition: pos.id };
  }
  return { defeatedPosition: null };
}

function positionsForTarget(ctx: EngineCtx, target: TargetDecl): Position[] {
  const ids = target.kind === 'position' ? [target.positionId] : target.kind === 'auto' ? [] : target.positionIds;
  return ids.map((id) => findPosition(ctx.st, id)).filter((p): p is Position => p !== undefined);
}

export function executeTechnique(ctx: EngineCtx, t: Technique, user: Combatant, target: TargetDecl, cause: number): void {
  const a = techniqueAvailability(t, ctx.st.config.effectsMode);
  if (a.baseOnly && a.status === 'uncurated') {
    emit(ctx.st, { type: 'warning', actor: user.uid, data: { technique: t.id, message: a.reason }, cause });
  }
  const n = t.class === 'status' ? 1 : hitCount(ctx, t, cause);
  const defeated: string[] = [];
  const declared = positionsForTarget(ctx, target);

  if (t.targeting === 'all') {
    for (let i = 0; i < n; i++) {
      for (const p of autoTargets(ctx, t, user)) {
        const r = resolveHit(ctx, t, user, p, i, cause);
        if (r.defeatedPosition) defeated.push(r.defeatedPosition);
      }
    }
  } else if (target.kind === 'perHit') {
    for (let i = 0; i < n; i++) {
      const p = declared[Math.min(i, declared.length - 1)];
      if (!p) break;
      if (i >= declared.length) emit(ctx.st, { type: 'rule_gap', data: { gap: 'GAP-MULTI-OVERFLOW', hitIndex: i }, cause });
      const r = resolveHit(ctx, t, user, p, i, cause);
      if (r.defeatedPosition) defeated.push(r.defeatedPosition);
    }
  } else {
    // Objetivo unico: se detiene al derrotar; secuencia Multiobjetivo: pasa a la siguiente posicion declarada (19.4)
    let idx = 0;
    for (let i = 0; i < n && idx < declared.length; i++) {
      const p = declared[idx]!;
      const r = resolveHit(ctx, t, user, p, i, cause);
      if (r.defeatedPosition) {
        defeated.push(r.defeatedPosition);
        idx++;
      }
    }
  }

  emit(ctx.st, { type: 'technique_end', actor: user.uid, data: { technique: t.id, defeats: defeated.length }, cause, ruleRef: 'CANON-MECHANICS 19.4' });
  // CANON-MECHANICS 19.4 / 28.5: Reemplazos forzados solo al terminar la tecnica
  for (const pid of defeated) forcedReplacement(ctx, pid, cause);
}
