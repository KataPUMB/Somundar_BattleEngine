export interface RngState {
  seed: number;
  state: number;
  draws: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0, state: seed >>> 0, draws: 0 };
}

// mulberry32: determinista y serializable en un unico entero
export function nextFloat(rng: RngState): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  rng.draws++;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng: RngState, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(nextFloat(rng) * (maxInclusive - minInclusive + 1));
}
