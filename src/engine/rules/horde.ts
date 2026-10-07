// Balance de la colonia de Holomicor (GAP-HOLOMICOR-COLONY). Todos los numeros de ajuste viven aqui.

/** Vitalidad: mult(n) = 1 + bonusPerCorpse * (n - 1) ^ exponent; con 1 cadaver vale x1 */
export const HOLOMICOR_HP_SCALING = { bonusPerCorpse: 0.4, exponent: 0.7 } as const;

/** Horda contra un objetivo: hasta freeContact cadaveres golpean sin estorbarse; el resto rinde con exponente < 1 */
export const HORDE_CONGESTION = { freeContact: 3, exponent: 0.5 } as const;

export const HORDE_MAX_HITS_PER_TARGET = 16;

/** Cadaveres que se suponen cuando la instancia no declara corpseCount (comportamiento anterior: 3 golpes) */
export const HORDE_DEFAULT_CORPSES = 3;

const asCount = (n: number | undefined, fallback: number): number => (n !== undefined && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback);

export function materializedCorpses(c: { corpseCount?: number; materializedCorpseCount?: number }): number {
  const total = asCount(c.corpseCount, HORDE_DEFAULT_CORPSES);
  return Math.min(total, asCount(c.materializedCorpseCount, total));
}

export function holomicorHpMultiplier(corpseCount?: number): number {
  const n = asCount(corpseCount, 1);
  return 1 + HOLOMICOR_HP_SCALING.bonusPerCorpse * (n - 1) ** HOLOMICOR_HP_SCALING.exponent;
}

export function hordeHitsPerTarget(corpses: number): number {
  if (!Number.isFinite(corpses) || corpses < 1) return 0;
  const c = Math.floor(corpses);
  const { freeContact, exponent } = HORDE_CONGESTION;
  if (c <= freeContact) return c;
  return Math.min(HORDE_MAX_HITS_PER_TARGET, Math.round(freeContact + (c - freeContact) ** exponent));
}

/** Impactos por objetivo, en el orden declarado; los cadaveres se reparten por igual entre los objetivos */
export function hordeHitPlan(materializedCorpses: number, targets: number): number[] {
  if (!Number.isFinite(materializedCorpses) || !Number.isFinite(targets) || materializedCorpses < 1 || targets < 1) return [];
  const m = Math.floor(materializedCorpses);
  const t = Math.floor(targets);
  const base = Math.floor(m / t);
  const extra = m % t;
  return Array.from({ length: t }, (_, i) => hordeHitsPerTarget(base + (i < extra ? 1 : 0)));
}
