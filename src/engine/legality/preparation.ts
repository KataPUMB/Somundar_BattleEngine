import type { GameData } from '../../data/schema.js';
import { STAT_KEYS, STATUS_IDS, TYPE_IDS, type BondedCreature, type BondedCreatureInput, type SideSetup, type SideSetupInput, type TypeId } from '../model/types.js';
import { learnableTechniques, minimumFormLevel, resolveSetup } from './species.js';

export interface Violation {
  severity: 'error' | 'warning';
  code: string;
  ruleRef: string;
  message: string;
  path?: string;
}

export function positionCapacityAtDeployment(setup: Pick<SideSetup, 'summoner'>): number {
  return setup.summoner.simultaneity === 'stable' ? 2 : 1;
}

function speciesIdOfTechnique(data: GameData, techniqueId: string): string | null {
  const t = data.techniques.get(techniqueId);
  if (!t?.species) return null;
  for (const s of data.species.values()) if (s.number === t.species.number) return s.id;
  return null;
}

function validateCreature(c: BondedCreature, raw: BondedCreatureInput, path: string, setup: SideSetup, data: GameData, out: Violation[]): void {
  const e = (code: string, ruleRef: string, message: string, p = path) => out.push({ severity: 'error', code, ruleRef, message, path: p });
  const w = (code: string, ruleRef: string, message: string, p = path) => out.push({ severity: 'warning', code, ruleRef, message, path: p });
  const s = setup.summoner;

  if (c.nickname !== undefined && (typeof c.nickname !== 'string' || c.nickname.trim() === '')) e('CRE_NICKNAME', 'escenario', 'nickname debe ser un texto no vacio');
  if (!Number.isInteger(c.nv) || c.nv < 1 || c.nv > 100) e('CRE_NV_RANGE', 'CANON-MECHANICS 1 (Nivel de Vinculo)', `NV ${c.nv} fuera de 1-100`);
  if (c.types.length < 1 || c.types.length > 2) e('CRE_TYPES', 'CANON-MECHANICS 22.2', 'una criatura tiene 1 o 2 tipos');
  for (const t of c.types) if (!TYPE_IDS.includes(t)) e('CRE_TYPES', 'CANON-MECHANICS 22', `tipo desconocido: ${t}`);
  for (const k of STAT_KEYS) {
    const v = c.baseStatsNV50?.[k];
    if (typeof v !== 'number' || !(v > 0)) e('CRE_STATS', 'CANON-MECHANICS 5', `estadistica NV50 ${k} ausente o no positiva`);
  }
  const sp = data.species.get(c.speciesId);
  if (!sp) w('CRE_SPECIES_UNKNOWN', 'creatures.json', `especie ${c.speciesId} no esta en creatures.json`);
  else {
    if (sp.types && [...sp.types].sort().join('/') !== [...c.types].sort().join('/')) {
      w('CRE_SPECIES_TYPES', 'CANON-CREATURES', `tipos de la instancia (${c.types.join('/')}) distintos de los de la ficha (${sp.types.join('/')})`);
    }
    const base = sp.baseStatsNV50;
    const diff = base ? STAT_KEYS.filter((k) => c.baseStatsNV50[k] !== base[k]) : [];
    if (diff.length > 0) w('CRE_SPECIES_STATS', 'CANON-CREATURES', `estadisticas NV50 de la instancia distintas de la ficha: ${diff.map((k) => `${k} ${c.baseStatsNV50[k]} (ficha ${base![k]})`).join(', ')}`);
    if (raw.priorForms && raw.priorForms.join('/') !== (c.priorForms ?? []).join('/')) {
      w('CRE_SPECIES_FORMS', 'CANON-CREATURES', `formas previas declaradas (${raw.priorForms.join('/')}) ignoradas; la ficha indica ${(c.priorForms ?? []).join('/') || 'ninguna'}`);
    }
    const minNv = minimumFormLevel(data, sp);
    if (c.nv < minNv) e('CRE_FORM_NV', 'CANON-CREATURES', `${sp.name} requiere NV ${minNv} o superior (NV ${c.nv})`);
  }
  for (const st of c.persistentStatuses) if (!STATUS_IDS.includes(st.id)) e('CRE_STATUS_UNKNOWN', 'CANON-MECHANICS 24', `estado desconocido: ${st.id}`);

  // Fortaleza (9.2-9.4)
  if (c.orientations.length > 2) e('FORT_ORIENTATIONS', 'CANON-MECHANICS 9.2', `${c.orientations.length} Orientaciones activas (max. 2)`);
  let fortSum = 0;
  for (const [k, v] of Object.entries(c.fortaleza)) {
    if (v === undefined) continue;
    fortSum += v;
    if (!Number.isInteger(v) || v < 0) e('FORT_INTEGER', 'CANON-MECHANICS 9.3', `Fortaleza ${k}=${v} debe ser entero >= 0`);
    if (v > 25) e('FORT_MAX_25', 'CANON-MECHANICS 9.4', `Fortaleza ${k}=+${v}% supera +25%`);
    else if (v > s.fortalezaMaxPerStat) e('FORT_MAX_STAT', 'CANON-MECHANICS 9.4', `Fortaleza ${k}=+${v}% supera el maximo por estadistica del invocador (+${s.fortalezaMaxPerStat}%)`);
  }
  if (fortSum > s.fortalezaCapacity) e('FORT_CAPACITY', 'CANON-MECHANICS 9.4', `Fortaleza total +${fortSum}% supera la capacidad (+${s.fortalezaCapacity}%)`);

  // Tecnicas (8.1-8.2)
  if (c.equippedTechniques.length > 4) e('TECH_MAX_4', 'CANON-MECHANICS 8.1', `${c.equippedTechniques.length} tecnicas equipadas (max. 4)`);
  const learnable = sp ? learnableTechniques(data, sp, c.nv) : null;
  let local = 0;
  c.equippedTechniques.forEach((tid, i) => {
    const t = data.techniques.get(tid);
    const tp = `${path}.equippedTechniques[${i}]`;
    if (!t) {
      e('TECH_UNKNOWN', 'techniques.json', `tecnica desconocida: ${tid}`, tp);
      return;
    }
    local += t.bondCost;
    if (t.category === 'special') {
      const owner = speciesIdOfTechnique(data, tid);
      const allowed = [c.speciesId, ...(c.priorForms ?? [])];
      if (!owner || !allowed.includes(owner)) {
        e('TECH_SPECIES', 'CANON-TECHNIQUES Coste de Vinculo y equipamiento', `${t.name} es tecnica especial de ${owner ?? '?'}, no de ${c.speciesId}`, tp);
      }
    }
    if (learnable && !learnable.has(tid)) {
      e('TECH_LEARNSET', 'CANON-CREATURES Tecnicas', `${sp!.name} no aprende ${t.name} con NV ${c.nv}`, tp);
    }
  });
  if (local > 100) e('TECH_LOCAL_COST', 'CANON-MECHANICS 8.2', `coste local ${local} supera 100`);

  (c.horde ?? []).forEach((h, i) => {
    if (!(h.atkNV50 > 0)) e('HORDE_CORPSE_STATS', 'CANON-TECHNIQUES Horda', `cadaver ${h.speciesId}: falta atkNV50 (especie fuera de la guia)`, `${path}.horde[${i}]`);
  });

  // Manifestaciones (10.2-10.3)
  const slots = c.nv >= 50 ? 2 : 1;
  if (c.equippedManifestations.length > slots) {
    e('MANI_SLOTS', 'CANON-MECHANICS 10.2', `${c.equippedManifestations.length} Manifestaciones con NV${c.nv} (max. ${slots})`);
  }
  c.equippedManifestations.forEach((mid, i) => {
    const m = data.manifestations.get(mid);
    const mp = `${path}.equippedManifestations[${i}]`;
    if (!m) {
      e('MANI_UNKNOWN', 'manifestations.json', `Manifestacion desconocida: ${mid}`, mp);
      return;
    }
    if (!s.manifestationRepertoire.includes(mid)) e('MANI_REPERTOIRE', 'CANON-MECHANICS 10.4', `${m.name} no esta en el repertorio del invocador`, mp);
    if (m.element !== 'global' && !c.types.includes(m.element as TypeId)) {
      e('MANI_ELEMENT', 'CANON-MECHANICS 10.3', `${m.name} (${m.element}) incompatible con ${c.types.join('/')}`, mp);
    }
  });
}

export function validatePreparation(input: SideSetupInput, data: GameData): Violation[] {
  const setup = resolveSetup(input, data);
  const out: Violation[] = [];
  const e = (code: string, ruleRef: string, message: string, path?: string) => out.push({ severity: 'error', code, ruleRef, message, path });
  const s = setup.summoner;
  const prep = setup.preparation.creatures;

  if (s.fortalezaMaxPerStat > 25) e('SUM_FORT_MAX', 'CANON-MECHANICS 9.4', 'el maximo por estadistica no puede superar +25%', 'summoner');
  if (prep.length > 4) e('PREP_MAX_4', 'CANON-MECHANICS 7.1', `${prep.length} criaturas preparadas (max. 4)`, 'preparation');
  const ids = prep.map((c) => c.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) e('PREP_DUPLICATE', 'CANON-MECHANICS 7.1', `criatura repetida: ${id}`, 'preparation');

  prep.forEach((c, i) => validateCreature(c, input.preparation.creatures[i]!, `preparation.creatures[${i}]`, setup, data, out));

  // 8.5 / 8.6
  const total = prep.reduce((acc, c) => acc + c.equippedTechniques.reduce((a, t) => a + (data.techniques.get(t)?.bondCost ?? 0), 0), 0);
  if (s.amplitude !== null && total > s.amplitude) e('AMPLITUDE', 'CANON-MECHANICS 8.5', `coste total ${total} supera la Amplitud ${s.amplitude}`, 'preparation');

  // 10.4
  const seen = new Map<string, string>();
  prep.forEach((c) => c.equippedManifestations.forEach((m) => {
    const prev = seen.get(m);
    if (prev !== undefined) e('MANI_UNIQUE', 'CANON-MECHANICS 10.4', `${m} equipada en ${prev} y ${c.id}`, 'preparation');
    else seen.set(m, c.id);
  }));

  // 2.5
  const byLine = new Map<string, string>();
  for (const c of [...prep, ...(setup.otherBonds ?? [])]) {
    if (!c.transfigurationLine) continue;
    const prev = byLine.get(c.transfigurationLine);
    if (prev !== undefined && prev !== c.id) e('LINE_UNIQUE', 'CANON-MECHANICS 2.5', `${prev} y ${c.id} pertenecen a la linea ${c.transfigurationLine}`, 'bonds');
    else byLine.set(c.transfigurationLine, c.id);
  }

  // 13.4 / 7.2
  const cap = positionCapacityAtDeployment(setup);
  const dep = setup.initialDeployment;
  if (dep.length > cap) e('DEPLOY_POSITIONS', 'CANON-MECHANICS 13.2 / 13.4', `${dep.length} posiciones iniciales (max. ${cap})`, 'initialDeployment');
  const placed = dep.filter((x): x is string => x !== null);
  if (placed.length === 0 && prep.length > 0) e('DEPLOY_EMPTY', 'CANON-MECHANICS 13.4', 'el despliegue inicial no materializa ninguna criatura', 'initialDeployment');
  for (const id of placed) {
    if (!ids.includes(id)) e('DEPLOY_NOT_PREPARED', 'CANON-MECHANICS 7.2', `${id} no esta preparada`, 'initialDeployment');
  }
  if (new Set(placed).size !== placed.length) e('DEPLOY_DUPLICATE', 'CANON-MECHANICS 13.4', 'una criatura no puede ocupar dos posiciones', 'initialDeployment');
  return out;
}

export function hasErrors(v: Violation[]): boolean {
  return v.some((x) => x.severity === 'error');
}
