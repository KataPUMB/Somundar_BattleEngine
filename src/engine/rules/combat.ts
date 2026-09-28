import type { TypesData } from '../../data/schema.js';
import type { StatusId, TypeId } from '../model/types.js';

// CANON-MECHANICS 22.2: producto de multiplicadores defensivos, sin STAB
export function typeMultiplier(types: TypesData, attackType: TypeId | null, defenderTypes: readonly TypeId[]): number {
  if (attackType === null) return 1;
  return defenderTypes.reduce((acc, d) => acc * (types.effectiveness[attackType][d] ?? 1), 1);
}

// CANON-MECHANICS 24.1 / 24.11
export function isImmuneToStatus(types: TypesData, creatureTypes: readonly TypeId[], status: StatusId): boolean {
  return creatureTypes.some((t) => (types.immunities[t] ?? []).includes(status));
}

export interface DamageInput {
  power: number;
  attack: number;
  defense: number;
  damagePcts: number[];
  typeMult: number;
  halvings: number;
  ignoreDefense: boolean;
}

// CANON-MECHANICS 23.1-23.4: sin redondeo intermedio
export function rawDamage(i: DamageInput): number {
  const m = Math.max(0, 1 + i.damagePcts.reduce((a, b) => a + b, 0) / 100);
  const r = 2 ** i.halvings;
  const root = i.ignoreDefense ? 1 : Math.sqrt(i.attack / Math.max(1, i.defense));
  return (0.75 * (i.power / 100) * i.attack * root * m * i.typeMult) / r;
}

export interface DamageOutcome {
  raw: number;
  calculated: number;
  loss: number;
}

// CANON-MECHANICS 23.5
export function finalizeDamage(raw: number, maxHp: number, currentHp: number): DamageOutcome {
  const calculated = Math.max(0, Math.min(maxHp, Math.round(raw)));
  return { raw, calculated, loss: Math.min(calculated, currentHp) };
}
