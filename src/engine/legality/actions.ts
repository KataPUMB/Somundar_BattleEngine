import type { Technique } from '../../data/schema.js';
import type { Action, BattleState, Combatant, Position, TargetDecl } from '../model/battle.js';
import { techniqueAvailability } from '../effects/availability.js';
import { auraOps, evalCondition, marksOf } from '../effects/runtime.js';
import { allPositions, combatant, findPosition, sideOf, type EngineCtx } from '../pipeline/context.js';
import { isViableReserve, restrictionActive } from '../pipeline/combatant.js';
import { withdrawBlocker } from '../pipeline/lifecycle.js';

export interface ActionOption {
  action: Action;
  legal: boolean;
  reason?: string;
  ruleRef?: string;
  targetPositions?: string[];
  targeting?: Technique['targeting'];
  targetSide?: 'self' | 'ally' | 'side' | 'any';
  choices?: string[];
}

function activeBonds(st: BattleState, side: 0 | 1): number {
  return sideOf(st, side).positions.filter((p) => p.occupantUid !== null || p.partialUid !== null).length;
}

// Restricciones propias de la tecnica y del usuario que la hacen ilegal (14.3)
export function techniqueBlockReason(ctx: EngineCtx, user: Combatant, t: Technique, partial: boolean): string | null {
  const a = techniqueAvailability(t, ctx.st.config.effectsMode);
  if (!a.executable) return a.reason ?? 'tecnica no ejecutable';
  const ov = t.override;
  if (ov?.requiresInstinct && !user.creature.instinct) return 'la criatura no tiene fijada su aptitud (instinct)';
  if (!partial) {
    const dis = restrictionActive(user, 'no_same_technique_consecutive');
    if (dis && user.lastTurnTechniqueId === t.id) return `${dis}: no puede repetir la tecnica del turno anterior (24.8)`;
    if (ov?.noConsecutiveUse && user.lastTurnTechniqueId === t.id) return 'no puede usarse dos turnos consecutivos';
  }
  if (marksOf(user, 'technique_lock').some((m) => m.params.techniqueId === t.id)) return 'bloqueada hasta retirarse y entrar de nuevo';
  const typeLock = marksOf(user, 'type_lock').find((m) => m.params.type === t.type && m.expires.kind === 'end_of_round' && ctx.st.round === m.expires.round);
  if (typeLock) return `no puede usar tecnicas de tipo ${t.type} este turno (${typeLock.source})`;
  if (ov?.usableIf && !evalCondition(ctx, ov.usableIf, { subject: user, user, technique: t })) return 'no se cumple su condicion de uso';
  if (!partial && user.committedTechnique !== null && user.committedTechnique !== t.id) {
    const commit = auraOps(ctx, user, 'commitFirstTechnique', { subject: user }).find((x) => x.carrier === user);
    if (commit) return `${commit.source}: solo puede repetir ${user.committedTechnique} mientras permanezca en campo`;
  }
  if (ov?.handler === 'horda') {
    const horde = user.creature.horde ?? [];
    const valid = horde.length >= 3 && horde.slice(0, 3).every((h) => {
      const ct = ctx.data.techniques.get(h.techniqueId);
      return ct?.category === 'anatomical' && ct.class === 'physical' && typeof ct.power?.perHit === 'number';
    });
    if (!valid) return 'Horda requiere tres cadaveres con una tecnica anatomica fisica cada uno (creature.horde, GAP-HORDA)';
  }
  return null;
}

function techniqueOption(ctx: EngineCtx, user: Combatant, tid: string, partial: boolean): ActionOption {
  const t = ctx.data.techniques.get(tid);
  const base = partial
    ? { kind: 'partial' as const, creatureId: user.creature.id, techniqueId: tid, target: { kind: 'auto' } as TargetDecl }
    : { kind: 'technique' as const, techniqueId: tid, target: { kind: 'auto' } as TargetDecl };
  if (!t) return { action: base, legal: false, reason: 'tecnica desconocida' };
  const side: NonNullable<ActionOption['targetSide']> = t.override?.targetSide ?? 'any';
  const targetPositions = side === 'ally' ? sideOf(ctx.st, user.side).positions.map((p) => p.id) : allPositions(ctx.st).map((p) => p.id);
  const info = { targeting: t.override?.declareAs ?? t.targeting, targetSide: side, targetPositions, choices: t.override?.choices };
  const blocked = techniqueBlockReason(ctx, user, t, partial);
  if (blocked) return { action: base, legal: false, reason: blocked, ruleRef: 'CANON-MECHANICS 14.3', ...info };
  return { action: base, legal: true, ...info };
}

export function legalActions(ctx: EngineCtx, positionId: string): ActionOption[] {
  const st = ctx.st;
  const pos = findPosition(st, positionId);
  if (!pos) return [];
  const side = sideOf(st, pos.side);
  const out: ActionOption[] = [];

  if (pos.occupantUid) {
    const user = combatant(st, pos.occupantUid);
    if (user.charging) {
      out.push({ action: { kind: 'technique', techniqueId: user.charging.techniqueId, target: user.charging.target }, legal: true, reason: 'ejecucion de la carga', ruleRef: 'CANON-MECHANICS 19.5 / GAP-CHARGE-ACTIONS' });
    } else {
      for (const tid of user.creature.equippedTechniques) out.push(techniqueOption(ctx, user, tid, false));
      out.push({ action: { kind: 'dodge' }, legal: true, ruleRef: 'CANON-MECHANICS 17' });
    }
    const blocker = withdrawBlocker(user, true);
    for (const c of side.combatants) {
      if (c.uid === user.uid || c.location === 'field') continue;
      const action: Action = { kind: 'switch', incomingId: c.creature.id };
      if (!isViableReserve(c)) out.push({ action, legal: false, reason: 'no es una reserva viable', ruleRef: 'CANON-MECHANICS 26.1' });
      else if (blocker) out.push({ action, legal: false, reason: `${blocker}: no puede retirarse voluntariamente`, ruleRef: 'CANON-MECHANICS 24.5' });
      else out.push({ action, legal: true, ruleRef: 'CANON-MECHANICS 16' });
    }
  } else if (side.summoner.partialMaterialization && activeBonds(st, pos.side) < 2) {
    for (const c of side.combatants) {
      if (!isViableReserve(c)) continue;
      for (const tid of c.creature.equippedTechniques) out.push(techniqueOption(ctx, c, tid, true));
    }
  }
  if (pos.occupantUid || out.length > 0) out.push({ action: { kind: 'surrender' }, legal: true, ruleRef: 'CANON-MECHANICS 26.3' });
  return out;
}

function sameOption(opt: Action, a: Action): boolean {
  if (opt.kind !== a.kind) return false;
  switch (a.kind) {
    case 'technique':
      return opt.kind === 'technique' && opt.techniqueId === a.techniqueId;
    case 'partial':
      return opt.kind === 'partial' && opt.techniqueId === a.techniqueId && opt.creatureId === a.creatureId;
    case 'switch':
      return opt.kind === 'switch' && opt.incomingId === a.incomingId;
    default:
      return true;
  }
}

function validateTarget(ctx: EngineCtx, t: Technique, target: TargetDecl, ownSide: 0 | 1): string | null {
  const side = t.override?.targetSide;
  if (side === 'self' || side === 'side') return null;
  const pos = (id: string) => findPosition(ctx.st, id);
  const okPos = (id: string) => !!pos(id) && (side !== 'ally' || pos(id)!.side === ownSide);
  switch (t.override?.declareAs ?? t.targeting) {
    case 'single':
      return target.kind === 'position' && okPos(target.positionId) ? null : side === 'ally' ? 'requiere una posicion aliada' : 'Objetivo unico requiere una posicion existente';
    case 'multi':
      if (target.kind === 'position') return okPos(target.positionId) ? null : 'posicion inexistente';
      if (target.kind === 'sequence' || target.kind === 'perHit') {
        return target.positionIds.length > 0 && target.positionIds.every(okPos) ? null : 'reparto con posiciones inexistentes o vacio';
      }
      return 'Multiobjetivo requiere posicion, secuencia o reparto';
    case 'all':
      return target.kind === 'auto' ? null : 'A todos no elige objetivos';
  }
}

export function validateDeclaration(ctx: EngineCtx, positionId: string, action: Action): string | null {
  const opts = legalActions(ctx, positionId);
  const match = opts.find((o) => sameOption(o.action, action));
  if (!match) return 'accion no disponible en esta posicion';
  if (!match.legal) return match.reason ?? 'accion ilegal';
  if (action.kind === 'technique' || action.kind === 'partial') {
    const pos = findPosition(ctx.st, positionId)!;
    if (action.kind === 'technique' && pos.occupantUid && combatant(ctx.st, pos.occupantUid).charging) return null;
    const t = ctx.data.techniques.get(action.techniqueId);
    if (!t) return 'tecnica desconocida';
    const choices = t.override?.choices;
    if (choices && !choices.includes(action.choice ?? '')) return `debe elegir una opcion: ${choices.join(', ')}`;
    return validateTarget(ctx, t, action.target, pos.side);
  }
  return null;
}

export function positionsNeedingDeclaration(st: BattleState): Position[] {
  return allPositions(st).filter((p) => p.occupantUid !== null);
}
