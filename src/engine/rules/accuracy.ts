export interface AccuracyModifiers {
  relativePct: number[];
  percentagePoints: number[];
}

// CANON-MECHANICS 20.2 / 20.3
export function finalAccuracy(base: number, mods: AccuracyModifiers, neverMiss = false): number {
  if (neverMiss) return 100;
  const rel = mods.relativePct.reduce((a, b) => a + b, 0) / 100;
  const pp = mods.percentagePoints.reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(100, base * (1 + rel) + pp));
}

// CANON-MECHANICS 17
export const DODGE_CHANCES = [100, 50, 12.5, 0] as const;

export function dodgeChance(consecutiveUseIndex: number): number {
  return DODGE_CHANCES[Math.min(consecutiveUseIndex, DODGE_CHANCES.length - 1)] as number;
}
