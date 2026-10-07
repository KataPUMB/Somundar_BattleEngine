import type { GameData, StatusRestrictionKind } from '../../data/schema.js';
import type { Combatant, SideIndex } from '../model/battle.js';
import { STAGE_KEYS, type BondedCreature, type StageKey, type StatKey, type StatusId } from '../model/types.js';
import { effectiveStat, stableStats, type DirectModifier } from '../rules/stats.js';
import { isImmuneToStatus } from '../rules/combat.js';
import type { AccuracyModifiers } from '../rules/accuracy.js';
import { holomicorHpMultiplier } from '../rules/horde.js';

export function zeroStages(): Record<StageKey, number> {
  return Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])) as Record<StageKey, number>;
}

export function createCombatant(side: SideIndex, creature: BondedCreature, speciesName?: string): Combatant {
  const stable = stableStats(creature.baseStatsNV50, creature.nv, creature.fortaleza);
  stable.hp = Math.max(1, Math.round(stable.hp * holomicorHpMultiplier(creature.corpseCount)));
  const hp = creature.hpCurrent === undefined ? stable.hp : Math.max(0, Math.min(stable.hp, creature.hpCurrent));
  return {
    uid: `${side}:${creature.id}`,
    side,
    creature,
    displayName: creature.nickname?.trim() || speciesName || creature.id,
    stable,
    maxHp: stable.hp,
    hp,
    stages: zeroStages(),
    statuses: creature.persistentStatuses.map((s) => ({ id: s.id, counters: { ...s.counters } })),
    location: hp > 0 ? 'intermedio' : 'defeated',
    positionId: null,
    dodgeStreak: 0,
    charging: null,
    lastTurnTechniqueId: null,
    turnsMaterialized: 0,
    presentAtDeclaration: false,
    dodgingThisRound: false,
    turnsSinceEntry: 0,
    actedThisRound: false,
    flinched: false,
    entryBonusesUsed: [],
    marks: [],
    damagedThisRound: false,
    lastDamageDealtRound: null,
    lastDamagingMissed: false,
    techUses: {},
    streak: null,
    committedTechnique: null,
    everUsed: [],
    onceUsed: [],
  };
}

export function statusModifiers(data: GameData, c: Combatant, key: StatKey | 'accuracy'): DirectModifier[] {
  const out: DirectModifier[] = [];
  for (const s of c.statuses) {
    const pct = data.statuses.get(s.id)?.statModifiersPct[key];
    if (pct !== undefined) out.push({ pct, fromStatus: true, source: s.id });
  }
  return out;
}

// CANON-MECHANICS 5.2 / 21.3
export function effStat(data: GameData, c: Combatant, key: Exclude<StatKey, 'hp'>): number {
  return effectiveStat(c.stable[key], c.stages[key], statusModifiers(data, c, key));
}

export function effSpeed(data: GameData, c: Combatant): number {
  return effStat(data, c, 'spe');
}

// CANON-MECHANICS 20.2 / 24.1: de los estados solo cuenta la penalizacion mas severa
export function accuracyModifiers(data: GameData, c: Combatant): AccuracyModifiers {
  const worst = Math.min(0, ...statusModifiers(data, c, 'accuracy').map((m) => m.pct));
  return { relativePct: worst < 0 ? [worst] : [], percentagePoints: [] };
}

export function restrictionActive(c: Combatant, kind: StatusRestrictionKind): StatusId | null {
  for (const s of c.statuses) if ((s.counters[kind] ?? 0) > 0) return s.id;
  return null;
}

export type ApplyStatusResult = 'applied' | 'immune' | 'already_present';

// CANON-MECHANICS 24.1
export function applyStatus(data: GameData, c: Combatant, status: StatusId): ApplyStatusResult {
  if (isImmuneToStatus(data.types, c.creature.types, status)) return 'immune';
  if (c.statuses.some((s) => s.id === status)) return 'already_present';
  const def = data.statuses.get(status);
  const counters: Record<string, number> = {};
  for (const r of def?.restrictions ?? []) counters[r.kind] = r.turns;
  c.statuses.push({ id: status, counters });
  return 'applied';
}

export function isViableReserve(c: Combatant): boolean {
  return c.location === 'intermedio' && c.hp > 0;
}
