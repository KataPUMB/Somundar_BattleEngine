import type { StatBlock, StatKey } from '../model/types.js';

// CANON-MECHANICS 5.1
export function levelFactor(nv: number): number {
  return 2 / 3 + nv / 150;
}

// CANON-MECHANICS 21.1: redondeo unico tras Nivel y Fortaleza
export function stableStat(statNV50: number, nv: number, fortalezaPct = 0): number {
  return Math.round(statNV50 * levelFactor(nv) * (1 + fortalezaPct / 100));
}

export function stableStats(base: StatBlock, nv: number, fortaleza: Partial<StatBlock>): StatBlock {
  const out = {} as StatBlock;
  for (const k of Object.keys(base) as StatKey[]) out[k] = stableStat(base[k], nv, fortaleza[k] ?? 0);
  return out;
}

// CANON-MECHANICS 21.2
export const STAGE_MULTIPLIERS: Readonly<Record<number, number>> = {
  6: 4, 5: 3.5, 4: 3, 3: 2.5, 2: 2, 1: 1.5, 0: 1,
  [-1]: 0.667, [-2]: 0.5, [-3]: 0.4, [-4]: 0.333, [-5]: 0.286, [-6]: 0.25,
};

export function clampStage(stage: number): number {
  return Math.max(-6, Math.min(6, Math.trunc(stage)));
}

export function stageMultiplier(stage: number): number {
  return STAGE_MULTIPLIERS[clampStage(stage)] as number;
}

export interface DirectModifier {
  pct: number;
  fromStatus: boolean;
  source: string;
}

// CANON-MECHANICS 21.3 / 24.1: de los estados solo cuenta la penalizacion mas severa
export function directModifierSum(mods: DirectModifier[]): number {
  let worstStatus = 0;
  let others = 0;
  for (const m of mods) {
    if (m.fromStatus) worstStatus = Math.min(worstStatus, m.pct);
    else others += m.pct;
  }
  return worstStatus + others;
}

// CANON-MECHANICS 21.3
export function effectiveStat(stable: number, stage: number, mods: DirectModifier[]): number {
  return Math.max(1, stable * stageMultiplier(stage) * Math.max(0, 1 + directModifierSum(mods) / 100));
}
