// CANON-MECHANICS 4.1
export const DEPTH_FACTORS = { fluida: 0.8, normal: 1, exigente: 1.2, dificil: 1.5, singular: 2 } as const;

// CANON-MECHANICS 4.3
export const CHALLENGE_MODIFIERS = { trivial: 0.25, inferior: 0.5, comparable: 1, superior: 1.5, excepcional: 2 } as const;

// CANON-MECHANICS 4.2
export function depthCostToNext(nv: number, fp: number): number {
  return 10 * nv * fp;
}

// CANON-MECHANICS 4.2
export function cumulativeDepth(nv: number, fp: number): number {
  return 5 * fp * nv * (nv - 1);
}

export function nvFromDepth(depth: number, fp: number): number {
  let nv = 1;
  while (nv < 100 && cumulativeDepth(nv + 1, fp) <= depth + 1e-9) nv++;
  return nv;
}

// CANON-MECHANICS 4.3
export function combatDepthGain(challengeNv: number, modifier: number): number {
  return 2 * challengeNv * modifier;
}
