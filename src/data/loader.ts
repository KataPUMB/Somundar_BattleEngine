import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DataIssue, GameData, Manifestation, ManifestationData, OverrideFile, SpeciesData, StatusData, Technique,
  TechniqueData, TypesData,
} from './schema.js';
import type { StatusId } from '../engine/model/types.js';
import { validateGameData, validateOverrideFile } from './validate.js';

export interface LoadResult {
  data: GameData;
  issues: DataIssue[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function loadGameData(dataDir: string): LoadResult {
  const techniquesRaw = readJson<{ techniques: TechniqueData[] }>(join(dataDir, 'techniques.json')).techniques;
  const manifestationsRaw = readJson<{ manifestations: ManifestationData[] }>(join(dataDir, 'manifestations.json')).manifestations;
  const types = readJson<TypesData>(join(dataDir, 'types.json'));
  const statusesRaw = readJson<{ conditions: StatusData[] }>(join(dataDir, 'status_conditions.json')).conditions;
  const speciesRaw = readJson<{ species: SpeciesData[] }>(join(dataDir, 'creatures.json')).species;

  const issues: DataIssue[] = validateGameData({ techniquesRaw, manifestationsRaw, types, statusesRaw, speciesRaw });

  const techniques = new Map<string, Technique>();
  for (const t of techniquesRaw) techniques.set(t.id, { ...t, override: null, overrideSource: null });
  const manifestations = new Map<string, Manifestation>();
  for (const m of manifestationsRaw) manifestations.set(m.id, { ...m, override: null, overrideSource: null });
  const statuses = new Map<StatusId, StatusData>(statusesRaw.map((s) => [s.id, s]));
  const species = new Map<string, SpeciesData>(speciesRaw.map((s) => [s.id, s]));

  const effectsDir = join(dataDir, 'effects');
  if (existsSync(effectsDir)) {
    for (const file of readdirSync(effectsDir).filter((f) => f.endsWith('.json')).sort()) {
      const rel = `effects/${file}`;
      let parsed: OverrideFile;
      try {
        parsed = readJson<OverrideFile>(join(effectsDir, file));
      } catch (e) {
        issues.push({ severity: 'error', file: rel, message: `JSON invalido: ${(e as Error).message}` });
        continue;
      }
      issues.push(...validateOverrideFile(parsed, rel, techniques, manifestations));
      for (const [id, ov] of Object.entries(parsed.techniques ?? {})) {
        const t = techniques.get(id);
        if (!t) continue;
        if (t.override) {
          issues.push({ severity: 'error', file: rel, id, message: `override duplicado (ya definido en ${t.overrideSource})` });
          continue;
        }
        t.override = ov;
        t.overrideSource = rel;
      }
      for (const [id, ov] of Object.entries(parsed.manifestations ?? {})) {
        const m = manifestations.get(id);
        if (!m) continue;
        if (m.override) {
          issues.push({ severity: 'error', file: rel, id, message: `override duplicado (ya definido en ${m.overrideSource})` });
          continue;
        }
        m.override = ov;
        m.overrideSource = rel;
      }
    }
  }

  return { data: { techniques, manifestations, types, statuses, species }, issues };
}
