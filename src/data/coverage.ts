import type { GameData } from './schema.js';
import { manifestationAvailability, techniqueAvailability, type CoverageStatus, type EffectsMode } from '../engine/effects/availability.js';

export interface CoverageEntry {
  id: string;
  name: string;
  status: CoverageStatus;
  executable: boolean;
  reason?: string;
  hasMechanicsHint: boolean;
}

export interface CoverageReport {
  mode: EffectsMode;
  techniques: { total: number; byStatus: Record<string, number>; executable: number; entries: CoverageEntry[] };
  manifestations: { total: number; byStatus: Record<string, number>; executable: number; entries: CoverageEntry[] };
}

function tally(entries: CoverageEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.status] = (out[e.status] ?? 0) + 1;
  return out;
}

export function buildCoverageReport(data: GameData, mode: EffectsMode): CoverageReport {
  const tEntries: CoverageEntry[] = [...data.techniques.values()].map((t) => {
    const a = techniqueAvailability(t, mode);
    return { id: t.id, name: t.name, status: a.status, executable: a.executable, reason: a.reason, hasMechanicsHint: Object.keys(t.mechanics).length > 0 };
  });
  const mEntries: CoverageEntry[] = [...data.manifestations.values()].map((m) => {
    const a = manifestationAvailability(m);
    return { id: m.id, name: m.name, status: a.status, executable: a.executable, reason: a.reason, hasMechanicsHint: Object.keys(m.mechanics).length > 0 };
  });
  return {
    mode,
    techniques: { total: tEntries.length, byStatus: tally(tEntries), executable: tEntries.filter((e) => e.executable).length, entries: tEntries },
    manifestations: { total: mEntries.length, byStatus: tally(mEntries), executable: mEntries.filter((e) => e.executable).length, entries: mEntries },
  };
}

export function formatCoverage(r: CoverageReport): string {
  const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');
  return [
    `Cobertura (modo ${r.mode})`,
    `  Tecnicas: ${r.techniques.total} | ejecutables ${r.techniques.executable} | ${fmt(r.techniques.byStatus)}`,
    `  Manifestaciones: ${r.manifestations.total} | activas ${r.manifestations.executable} | ${fmt(r.manifestations.byStatus)}`,
  ].join('\n');
}
