import type { GameData, SpeciesData } from '../../data/schema.js';
import type { BondedCreature, BondedCreatureInput, SideSetup, SideSetupInput, StatBlock } from '../model/types.js';

export function priorFormsOf(data: GameData, sp: SpeciesData): SpeciesData[] {
  const out: SpeciesData[] = [];
  let p = sp.previousForm ? data.species.get(sp.previousForm) : undefined;
  while (p) {
    out.unshift(p);
    p = p.previousForm ? data.species.get(p.previousForm) : undefined;
  }
  return out;
}

export function minimumFormLevel(data: GameData, sp: SpeciesData): number {
  let min = 1;
  for (const p of priorFormsOf(data, sp)) {
    const t = p.transfiguration;
    if (t) min = Math.max(min, t.kind === 'level' ? t.level : t.minLevel);
  }
  return min;
}

export function learnableTechniques(data: GameData, sp: SpeciesData, nv: number): Set<string> {
  const out = new Set<string>();
  for (const f of [...priorFormsOf(data, sp), sp]) {
    const listed = new Set([...f.learnset.map((l) => l.technique), ...f.onTransfigure, ...f.training]);
    for (const l of f.learnset) if (l.level <= nv) out.add(l.technique);
    for (const t of [...f.onTransfigure, ...f.training]) out.add(t);
    for (const t of f.signatureTechniques) if (!listed.has(t)) out.add(t);
  }
  return out;
}

export function resolveCreature(c: BondedCreatureInput, data: GameData): BondedCreature {
  const sp = data.species.get(c.speciesId);
  return {
    ...c,
    types: c.types ?? sp?.types ?? [],
    baseStatsNV50: c.baseStatsNV50 ?? (sp?.baseStatsNV50 ? { ...sp.baseStatsNV50 } : ({} as StatBlock)),
    transfigurationLine: sp ? sp.transfigurationLine : c.transfigurationLine,
    priorForms: sp ? priorFormsOf(data, sp).map((p) => p.id) : c.priorForms,
    canTransfigure: c.canTransfigure ?? !!sp?.nextForm,
    horde: c.horde?.map((h) => ({ ...h, atkNV50: h.atkNV50 ?? data.species.get(h.speciesId)?.baseStatsNV50?.atk ?? Number.NaN })),
  };
}

export function resolveSetup(setup: SideSetupInput, data: GameData): SideSetup {
  return {
    ...setup,
    preparation: { creatures: setup.preparation.creatures.map((c) => resolveCreature(c, data)) },
    otherBonds: setup.otherBonds?.map((c) => resolveCreature(c, data)),
  };
}
