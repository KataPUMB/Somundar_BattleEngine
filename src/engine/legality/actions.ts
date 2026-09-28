import type { Technique } from '../../data/schema.js';
import type { Action, BattleState, Combatant, Position, TargetDecl } from '../model/battle.js';
import { techniqueAvailability } from '../effects/availability.js';
import { allPositions, combatant, findPosition, sideOf, type EngineCtx } from '../pipeline/context.js';
import { isViableReserve, restrictionActive } from '../pipeline/combatant.js';

export interface ActionOption {
  action: Action;
  legal: boolean;
  reason?: string;
  ruleRef?: string;
  targetPositions?: string[];
  targeting?: Technique['targeting'];
}

function activeBonds(st: BattleState, side: 0 | 1): number {
  return sideOf(st, side).positions.filter((p) => p.occupantUid !== null || p.partialUid !== null).length;
}

function techniqueOption(ctx: EngineCtx, user: Combatant, tid: string, partial: boolean): ActionOption {
  const t = ctx.data.techniques.get(tid);
  const base = partial
    ? { kind: 'partial' as const, creatureId: user.creature.id, techniqueId: tid, target: { kind: 'auto' } as TargetDecl }
    : { kind: 'technique' as const, techniqueId: tid, target: { kind: 'auto' } as TargetDecl };
  if (!t) return { action: base, legal: false, reason: 'tecnica desconocida' };
  const targetPositions = allPositions(ctx.st).map((p) => p.id);
  const a = techniqueAvailability(t, ctx.st.config.effectsMode);
  if (!a.executable) return { action: base, legal: false, reason: a.reason, ruleRef: 'PROMPT 7.2 (strict)', targeting: t.targeting, targetPositions };
  if (!partial) {
    const dis = restrictionActive(user, 'no_same_technique_consecutive');
    if (dis && user.lastTurnTechniqueId === tid) {
      return { action: base, legal: false, reason: `${dis}: no puede repetir la tecnica del turno anterior`, ruleRef: 'CANON-MECHANICS 24.8', targeting: t.targeting, targetPositions };
    }
  }
  return { action: base, legal: true, targeting: t.targeting, targetPositions };
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
    const rooted = restrictionActive(user, 'no_voluntary_withdraw');
    for (const c of side.combatants) {
      if (c.uid === user.uid || c.location === 'field') continue;
      const action: Action = { kind: 'switch', incomingId: c.creature.id };
      if (!isViableReserve(c)) out.push({ action, legal: false, reason: 'no es una reserva viable', ruleRef: 'CANON-MECHANICS 26.1' });
      else if (rooted) out.push({ action, legal: false, reason: `${rooted}: no puede retirarse voluntariamente`, ruleRef: 'CANON-MECHANICS 24.5' });
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

function validateTarget(ctx: EngineCtx, t: Technique, target: TargetDecl): string | null {
  const exists = (id: string) => findPosition(ctx.st, id) !== undefined;
  switch (t.targeting) {
    case 'single':
      return target.kind === 'position' && exists(target.positionId) ? null : 'Objetivo unico requiere una posicion existente';
    case 'multi':
      if (target.kind === 'position') return exists(target.positionId) ? null : 'posicion inexistente';
      if (target.kind === 'sequence' || target.kind === 'perHit') {
        return target.positionIds.length > 0 && target.positionIds.every(exists) ? null : 'reparto con posiciones inexistentes o vacio';
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
    const occ = findPosition(ctx.st, positionId)?.occupantUid;
    if (action.kind === 'technique' && occ && combatant(ctx.st, occ).charging) return null;
    const t = ctx.data.techniques.get(action.techniqueId);
    if (t) return validateTarget(ctx, t, action.target);
  }
  return null;
}

export function positionsNeedingDeclaration(st: BattleState): Position[] {
  return allPositions(st).filter((p) => p.occupantUid !== null);
}
