// Balance de la colonia de Holomicor (GAP-HOLOMICOR-COLONY). Todos los numeros de ajuste viven aqui.
import type { ColonyState } from '../model/battle.js';
import type { HordeCorpse } from '../model/types.js';

/** Vitalidad: mult(n) = 1 + bonusPerCorpse * (n - 1) ^ exponent; con 1 cadaver vale x1 */
export const HOLOMICOR_HP_SCALING = { bonusPerCorpse: 0.4, exponent: 0.7 } as const;

/** Horda contra un objetivo: hasta freeContact cadaveres golpean sin estorbarse; el resto rinde con exponente < 1 */
export const HORDE_CONGESTION = { freeContact: 3, exponent: 0.5 } as const;

export const HORDE_MAX_HITS_PER_TARGET = 16;

/** Cadaveres que se suponen cuando la instancia no declara totalCorpseCount (comportamiento anterior: 3 golpes) */
export const HORDE_DEFAULT_CORPSES = 3;

const asCount = (n: number | undefined, fallback: number): number => (n !== undefined && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback);

export function holomicorHpMultiplier(totalCorpseCount?: number): number {
  const n = asCount(totalCorpseCount, 1);
  return 1 + HOLOMICOR_HP_SCALING.bonusPerCorpse * (n - 1) ** HOLOMICOR_HP_SCALING.exponent;
}

export function availableCorpses(c: ColonyState): number {
  return Math.max(0, c.total - c.destroyed);
}

export interface ColonyConfig {
  totalCorpseCount?: number;
  initialMaterializedCorpseCount?: number;
  destroyedCorpseCount?: number;
}

export function createColony(c: ColonyConfig): ColonyState | null {
  if (c.totalCorpseCount === undefined) return null;
  const total = asCount(c.totalCorpseCount, 1);
  const destroyed = Math.min(total - 1, Math.max(0, Math.floor(c.destroyedCorpseCount ?? 0)));
  return { total, destroyed, materialized: 0 };
}

/** Cuerpos con los que entra en combate: los pedidos o, por defecto, los de la configuracion */
export function entryCorpses(colony: ColonyState, config: ColonyConfig, requested?: number): number {
  const max = availableCorpses(colony);
  const wanted = requested ?? config.initialMaterializedCorpseCount ?? max;
  return Number.isFinite(wanted) ? Math.min(max, Math.max(1, Math.floor(wanted))) : max;
}

/** Cuerpos presentes para Horda; la Materializacion parcial no altera la colonia y usa el numero habitual */
export function presentCorpses(colony: ColonyState | null, config: ColonyConfig, partial: boolean): number {
  if (!colony) return HORDE_DEFAULT_CORPSES;
  return partial || colony.materialized < 1 ? entryCorpses(colony, config) : Math.min(colony.materialized, availableCorpses(colony));
}

/** Cuerpos en orden de materializacion: cada grupo se repite `count` veces (1 por defecto) */
export function hordeBodies<T extends Pick<HordeCorpse, 'count'>>(horde: readonly T[]): T[] {
  return horde.flatMap((h) => Array.from({ length: Math.max(1, Math.floor(h.count ?? 1)) }, () => h));
}

export function hasExplicitComposition(horde: readonly Pick<HordeCorpse, 'count'>[]): boolean {
  return horde.some((h) => h.count !== undefined);
}

export function hordeHitsPerTarget(corpses: number): number {
  if (!Number.isFinite(corpses) || corpses < 1) return 0;
  const c = Math.floor(corpses);
  const { freeContact, exponent } = HORDE_CONGESTION;
  if (c <= freeContact) return c;
  return Math.min(HORDE_MAX_HITS_PER_TARGET, Math.round(freeContact + (c - freeContact) ** exponent));
}

/** Impactos por objetivo, en el orden declarado; los cadaveres se reparten por igual entre los objetivos */
export function hordeHitPlan(corpses: number, targets: number): number[] {
  if (!Number.isFinite(corpses) || !Number.isFinite(targets) || corpses < 1 || targets < 1) return [];
  const m = Math.floor(corpses);
  const t = Math.floor(targets);
  const base = Math.floor(m / t);
  const extra = m % t;
  return Array.from({ length: t }, (_, i) => hordeHitsPerTarget(base + (i < extra ? 1 : 0)));
}
