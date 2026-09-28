import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadGameData } from '../data/loader.js';
import type { GameData, TechniqueOverride } from '../data/schema.js';
import { summonerFromPreset } from '../engine/model/presets.js';
import type { BondedCreature, Estamento, SideSetup, StatBlock, Summoner } from '../engine/model/types.js';
import type { BattleState, Declarations, SideIndex } from '../engine/model/battle.js';
import { beginRound, createBattle, resolveRound, type RoundStartChoice } from '../engine/pipeline/battle.js';
import type { BattleConfig } from '../engine/model/battle.js';
import type { BattleEvent } from '../engine/log/events.js';

export const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../Data');

export function loadData(): GameData {
  return loadGameData(DATA_DIR).data;
}

export function withTechniqueOverrides(data: GameData, ovs: Record<string, TechniqueOverride>): GameData {
  const techniques = new Map(data.techniques);
  for (const [id, ov] of Object.entries(ovs)) {
    const t = techniques.get(id);
    if (!t) throw new Error(`fixture: tecnica ${id} inexistente`);
    techniques.set(id, { ...t, override: ov, overrideSource: 'test' });
  }
  return { ...data, techniques };
}

export const FLAT_STATS: StatBlock = { hp: 300, atk: 100, matk: 100, def: 100, mdef: 100, spe: 100 };

export function creature(id: string, over: Partial<BondedCreature> = {}): BondedCreature {
  return {
    id,
    speciesId: 'riftari',
    types: ['fuego'],
    nv: 50,
    baseStatsNV50: { ...FLAT_STATS },
    fortaleza: {},
    orientations: [],
    equippedTechniques: ['aranazo'],
    equippedManifestations: [],
    persistentStatuses: [],
    ...over,
  };
}

export function summoner(id: string, estamento: Estamento = 'invocador', over: Partial<Summoner> = {}): Summoner {
  return summonerFromPreset(id, id, estamento, over);
}

export function setup(s: Summoner, creatures: BondedCreature[], deploy?: (string | null)[]): SideSetup {
  return { summoner: s, preparation: { creatures }, initialDeployment: deploy ?? [creatures[0]!.id] };
}

export function start(data: GameData, a: SideSetup, b: SideSetup, seed = 1, config: Partial<BattleConfig> = {}): BattleState {
  return createBattle(data, [a, b], { seed, config });
}

export function round(data: GameData, st: BattleState, decls: Declarations, choices: RoundStartChoice[] = []): BattleState {
  return resolveRound(data, beginRound(data, st, choices), decls);
}

export function eventsOf(st: BattleState, type: string, fromRound = 0): BattleEvent[] {
  return st.log.filter((e) => e.type === type && e.round >= fromRound);
}

export function uid(side: SideIndex, id: string): string {
  return `${side}:${id}`;
}
