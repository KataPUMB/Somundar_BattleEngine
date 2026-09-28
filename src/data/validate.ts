import type {
  DataIssue, Manifestation, ManifestationData, OverrideFile, SpeciesData, StatusData, Technique, TechniqueData, TypesData,
} from './schema.js';
import { STATUS_IDS, TYPE_IDS, type StatusId, type TypeId } from '../engine/model/types.js';
import { validateEffects } from '../engine/effects/dsl.js';

interface RawData {
  techniquesRaw: TechniqueData[];
  manifestationsRaw: ManifestationData[];
  types: TypesData;
  statusesRaw: StatusData[];
  speciesRaw: SpeciesData[];
}

const isType = (x: unknown): x is TypeId => TYPE_IDS.includes(x as TypeId);
const isStatus = (x: unknown): x is StatusId => STATUS_IDS.includes(x as StatusId);

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function validateGameData(raw: RawData): DataIssue[] {
  const issues: DataIssue[] = [];
  const err = (file: string, id: string | undefined, message: string) => issues.push({ severity: 'error', file, id, message });
  const warn = (file: string, id: string | undefined, message: string) => issues.push({ severity: 'warning', file, id, message });

  const T = 'techniques.json';
  for (const d of duplicates(raw.techniquesRaw.map((t) => t.id))) err(T, d, 'id duplicado');
  const speciesByNumber = new Map(raw.speciesRaw.map((s) => [s.number, s]));
  for (const t of raw.techniquesRaw) {
    if (!['anatomical', 'elemental', 'no_element', 'special'].includes(t.category)) err(T, t.id, `category invalida: ${t.category}`);
    if (!['physical', 'magical', 'status'].includes(t.class)) err(T, t.id, `class invalida: ${t.class}`);
    if (!['single', 'multi', 'all'].includes(t.targeting)) err(T, t.id, `targeting invalido: ${t.targeting}`);
    if (t.type !== null && !isType(t.type)) err(T, t.id, `tipo invalido: ${t.type}`);
    if (typeof t.bondCost !== 'number' || t.bondCost < 0 || t.bondCost > 100) err(T, t.id, `bondCost fuera de [0,100]: ${t.bondCost}`);
    else if (Math.abs(t.bondCost / 6.25 - Math.round(t.bondCost / 6.25)) > 1e-9) err(T, t.id, `bondCost no multiplo de 6,25: ${t.bondCost}`);
    if (!Number.isInteger(t.priority) || t.priority < -6 || t.priority > 3) err(T, t.id, `prioridad fuera de [-6,+3]: ${t.priority}`);
    if (typeof t.accuracy === 'number') {
      if (t.accuracy < 0 || t.accuracy > 100) err(T, t.id, `precision fuera de [0,100]: ${t.accuracy}`);
    } else {
      warn(T, t.id, `precision no numerica (${t.accuracy}); requiere curado o handler`);
    }
    if (t.class !== 'status') {
      const p = t.power;
      if (!p || !p.hits) err(T, t.id, 'tecnica de dano sin power/hits');
      else if (typeof p.perHit !== 'number') warn(T, t.id, `poder por impacto no numerico (${String(p.perHit)}); requiere handler`);
      else if (p.hits.min < 1 || p.hits.max < p.hits.min) err(T, t.id, `hits invalidos: ${p.hits.min}-${p.hits.max}`);
    }
    if (t.category === 'special') {
      if (!t.species) err(T, t.id, 'tecnica especial sin especie');
      else {
        const sp = speciesByNumber.get(t.species.number);
        if (!sp) err(T, t.id, `especie n.${t.species.number} inexistente en creatures.json`);
        else if (!sp.signatureTechniques.includes(t.id)) err(T, t.id, `la especie ${sp.id} no la lista en signatureTechniques`);
      }
    } else if (t.species) {
      warn(T, t.id, 'tecnica no especial con especie asignada');
    }
  }

  const M = 'manifestations.json';
  for (const d of duplicates(raw.manifestationsRaw.map((m) => m.id))) err(M, d, 'id duplicado');
  for (const m of raw.manifestationsRaw) {
    if (m.element !== 'global' && !isType(m.element)) err(M, m.id, `elemento invalido: ${m.element}`);
    if (m.environmentKind !== null && !['weather', 'field', 'anomaly'].includes(m.environmentKind)) {
      err(M, m.id, `environmentKind invalido: ${m.environmentKind}`);
    }
    if (!m.text) err(M, m.id, 'sin texto autoritativo');
  }

  const TY = 'types.json';
  const typeIds = raw.types.types.map((t) => t.id);
  if (typeIds.length !== TYPE_IDS.length || !TYPE_IDS.every((t) => typeIds.includes(t))) err(TY, undefined, 'lista de tipos distinta de los 9 canonicos');
  for (const a of TYPE_IDS) {
    for (const d of TYPE_IDS) {
      const v = raw.types.effectiveness[a]?.[d];
      if (typeof v !== 'number' || !(v > 0)) err(TY, `${a}->${d}`, `multiplicador ausente o invalido: ${String(v)}`);
    }
  }
  for (const [t, sts] of Object.entries(raw.types.immunities)) {
    if (!isType(t)) err(TY, t, 'inmunidad para tipo desconocido');
    for (const s of sts) if (!isStatus(s)) err(TY, t, `inmunidad a estado desconocido: ${s}`);
  }

  const S = 'status_conditions.json';
  const statusIds = raw.statusesRaw.map((s) => s.id);
  for (const d of duplicates(statusIds)) err(S, d, 'id duplicado');
  for (const s of STATUS_IDS) if (!statusIds.includes(s)) err(S, s, 'estado canonico ausente');
  for (const s of raw.statusesRaw) if (!isType(s.element)) err(S, s.id, `elemento invalido: ${s.element}`);

  const C = 'creatures.json';
  for (const d of duplicates(raw.speciesRaw.map((s) => s.id))) err(C, d, 'id duplicado');
  for (const d of duplicates(raw.speciesRaw.map((s) => String(s.number)))) err(C, `n.${d}`, 'numero de especie duplicado');
  const techIds = new Set(raw.techniquesRaw.map((t) => t.id));
  let withoutStats = 0;
  for (const s of raw.speciesRaw) {
    for (const tid of s.signatureTechniques) if (!techIds.has(tid)) err(C, s.id, `tecnica especial inexistente: ${tid}`);
    if (s.types !== null) {
      if (s.types.length < 1 || s.types.length > 2) err(C, s.id, 'debe tener 1 o 2 tipos');
      for (const ty of s.types) if (!isType(ty)) err(C, s.id, `tipo invalido: ${ty}`);
    }
    if (!s.baseStatsNV50) withoutStats++;
  }
  if (withoutStats > 0) warn(C, undefined, `${withoutStats} especies sin estadisticas NV50 (falta CANON-CREATURES); usar instancias explicitas`);
  return issues;
}

export function validateOverrideFile(
  file: OverrideFile,
  rel: string,
  techniques: Map<string, Technique>,
  manifestations: Map<string, Manifestation>,
): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const [id, ov] of Object.entries(file.techniques ?? {})) {
    if (!techniques.has(id)) issues.push({ severity: 'error', file: rel, id, message: 'override de tecnica inexistente' });
    if (ov.effects !== undefined) {
      for (const m of validateEffects(ov.effects, `techniques.${id}`)) issues.push({ severity: 'error', file: rel, id, message: m });
    }
  }
  for (const [id, ov] of Object.entries(file.manifestations ?? {})) {
    if (!manifestations.has(id)) issues.push({ severity: 'error', file: rel, id, message: 'override de Manifestacion inexistente' });
    if (ov.effects !== undefined) {
      for (const m of validateEffects(ov.effects, `manifestations.${id}`)) issues.push({ severity: 'error', file: rel, id, message: m });
    }
  }
  return issues;
}
