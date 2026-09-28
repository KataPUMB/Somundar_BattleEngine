import type { Combatant, Position } from '../model/battle.js';
import { emit } from '../log/events.js';
import { manifestationAvailability } from '../effects/availability.js';
import { combatant, findPosition, orderDesc, sideOf, type EngineCtx } from './context.js';
import { effSpeed, isViableReserve, zeroStages } from './combatant.js';

const ENTRY_TRIGGERS = ['on_entry', 'environment'];
const VOLUNTARY_WITHDRAW_TRIGGERS = ['on_voluntary_withdraw', 'on_withdraw', 'on_switch_out'];

export function placeOnField(ctx: EngineCtx, c: Combatant, pos: Position, cause?: number): number {
  c.location = 'field';
  c.positionId = pos.id;
  c.dodgeStreak = 0;
  pos.occupantUid = c.uid;
  return emit(ctx.st, { type: 'materialize', actor: c.uid, targets: [pos.id], cause, ruleRef: 'CANON-MECHANICS 1 (Materializacion)' });
}

export function entryManifestations(ctx: EngineCtx, c: Combatant): string[] {
  return c.creature.equippedManifestations.filter((id) => ENTRY_TRIGGERS.includes(ctx.data.manifestations.get(id)?.trigger ?? ''));
}

// Fase 4: sin interprete de efectos; se registra cada activacion como inerte para auditoria
export function resolveManifestation(ctx: EngineCtx, c: Combatant, manifestationId: string, cause?: number): void {
  const m = ctx.data.manifestations.get(manifestationId);
  if (!m) return;
  const a = manifestationAvailability(m);
  emit(ctx.st, {
    type: a.executable ? 'manifestation' : 'manifestation_inert',
    actor: c.uid,
    data: { manifestation: manifestationId, trigger: m.trigger, status: a.status, reason: a.reason },
    cause,
    ruleRef: 'CANON-MECHANICS 10.7',
  });
}

// CANON-MECHANICS 1 (Entrada) / 10.7 / 16.3: la Entrada forma parte de la Materializacion
export function materializeWithEntry(ctx: EngineCtx, c: Combatant, pos: Position, cause?: number): void {
  const ev = placeOnField(ctx, c, pos, cause);
  for (const m of entryManifestations(ctx, c)) resolveManifestation(ctx, c, m, ev);
  emit(ctx.st, { type: 'entry_complete', actor: c.uid, targets: [pos.id], cause: ev, ruleRef: 'CANON-MECHANICS 10.7' });
}

export type ExitKind = 'withdraw' | 'defeat' | 'forced' | 'position_closed';

// CANON-MECHANICS 21.4 / 19.5: cualquier Salida borra etapas y pierde la carga; los estados persisten
export function exitField(ctx: EngineCtx, c: Combatant, kind: ExitKind, cause?: number): number {
  if (kind === 'withdraw') {
    for (const id of c.creature.equippedManifestations) {
      if (VOLUNTARY_WITHDRAW_TRIGGERS.includes(ctx.data.manifestations.get(id)?.trigger ?? '')) resolveManifestation(ctx, c, id, cause);
    }
  }
  const pos = c.positionId ? findPosition(ctx.st, c.positionId) : undefined;
  if (pos && pos.occupantUid === c.uid) pos.occupantUid = null;
  const hadCharge = c.charging !== null;
  c.stages = zeroStages();
  c.charging = null;
  c.dodgeStreak = 0;
  c.dodgingThisRound = false;
  c.lastTurnTechniqueId = null;
  c.positionId = null;
  c.location = kind === 'defeat' ? 'defeated' : 'intermedio';
  return emit(ctx.st, {
    type: kind === 'defeat' ? 'defeat' : 'exit',
    actor: c.uid,
    targets: pos ? [pos.id] : [],
    data: { kind, chargeLost: hadCharge },
    cause,
    ruleRef: kind === 'defeat' ? 'CANON-MECHANICS 26.1' : 'CANON-MECHANICS 21.4',
  });
}

// CANON-MECHANICS 16.6: no consume accion, no hereda la accion pendiente, activa Entradas
export function forcedReplacement(ctx: EngineCtx, positionId: string, cause?: number): void {
  const pos = findPosition(ctx.st, positionId);
  if (!pos || pos.occupantUid !== null) return;
  const side = sideOf(ctx.st, pos.side);
  const candidates = side.combatants.filter(isViableReserve).map((c) => c.uid);
  if (candidates.length === 0) {
    emit(ctx.st, { type: 'no_replacement', targets: [pos.id], cause, ruleRef: 'CANON-MECHANICS 16.6' });
    return;
  }
  const chosen = ctx.controllers.chooseReplacement?.(ctx.st, pos.side, pos.id, candidates) ?? candidates[0]!;
  const uid = candidates.includes(chosen) ? chosen : candidates[0]!;
  const ev = emit(ctx.st, { type: 'forced_replacement', actor: uid, targets: [pos.id], cause, ruleRef: 'CANON-MECHANICS 16.6' });
  materializeWithEntry(ctx, combatant(ctx.st, uid), pos, ev);
}

// CANON-MECHANICS 13.4 / 28.1: primero presencia fisica por Velocidad, despues Entradas por Velocidad
export function initialDeployment(ctx: EngineCtx, placements: { c: Combatant; pos: Position }[]): void {
  const label = (x: { c: Combatant }) => x.c.uid;
  const physical = orderDesc(ctx, placements, (x) => [effSpeed(ctx.data, x.c)], 'deployment', label);
  for (const p of physical) placeOnField(ctx, p.c, p.pos);
  const pending = physical.flatMap((p) => entryManifestations(ctx, p.c).map((m) => ({ c: p.c, m })));
  const ordered = orderDesc(ctx, pending, (x) => [effSpeed(ctx.data, x.c)], 'deployment_entries', (x) => `${x.c.uid}/${x.m}`);
  for (const x of ordered) resolveManifestation(ctx, x.c, x.m);
  emit(ctx.st, { type: 'deployment_complete', ruleRef: 'CANON-MECHANICS 28.1' });
}
