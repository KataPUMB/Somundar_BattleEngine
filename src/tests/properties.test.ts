import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle, legalMap } from '../app/simulate.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import { beginRound, createBattle, resolveRound } from '../engine/pipeline/battle.js';
import { effStat } from '../engine/pipeline/combatant.js';
import { createRng, nextInt, type RngState } from '../engine/rng.js';
import type { BattleState, Declarations, SideIndex } from '../engine/model/battle.js';
import type { Estamento, SideSetup, TypeId } from '../engine/model/types.js';
import { learnableTechniques, minimumFormLevel } from '../engine/legality/species.js';
import { creature, loadData, summoner } from './helpers.js';

const data = loadData();
const executable = [...data.techniques.values()];
const corpseTechniques = executable.filter((t) => t.category === 'anatomical' && t.class === 'physical' && typeof t.power?.perHit === 'number');
const special = executable.filter((t) => t.category === 'special');
const speciesByNumber = new Map([...data.species.values()].map((s) => [s.number, s]));
const manifestations = [...data.manifestations.values()].filter((m) => m.override?.effects);

function randomSetup(rng: RngState, tag: string): SideSetup {
  const estamentos: Estamento[] = ['iniciado', 'adepto', 'invocador', 'magister', 'arconte'];
  const s = summoner(tag, estamentos[nextInt(rng, 0, estamentos.length - 1)]!, { amplitude: null, manifestationRepertoire: manifestations.map((m) => m.id) });
  const n = nextInt(rng, 1, 4);
  const usedManifestations = new Set<string>();
  const usedLines = new Set<string | null>();
  const creatures = Array.from({ length: n }, (_, i) => {
    let sig = special[nextInt(rng, 0, special.length - 1)]!;
    while (usedLines.has(speciesByNumber.get(sig.species!.number)!.transfigurationLine)) sig = special[nextInt(rng, 0, special.length - 1)]!;
    const sp = speciesByNumber.get(sig.species!.number)!;
    usedLines.add(sp.transfigurationLine);
    const types = sp.types!;
    let nv = nextInt(rng, minimumFormLevel(data, sp), 100);
    if (!learnableTechniques(data, sp, nv).has(sig.id)) nv = 100;
    const pool = [...learnableTechniques(data, sp, nv)].map((id) => data.techniques.get(id)!).filter((t) => t.category !== 'special');
    const techs = new Map<string, number>([[sig.id, sig.bondCost]]);
    for (let k = 0; k < 10 && techs.size < 4 && pool.length > 0; k++) {
      const t = pool[nextInt(rng, 0, pool.length - 1)]!;
      const used = [...techs.values()].reduce((a, b) => a + b, 0);
      if (used + t.bondCost <= 100) techs.set(t.id, t.bondCost);
    }
    const compatible = manifestations.filter((m) => !usedManifestations.has(m.id) && (m.element === 'global' || types.includes(m.element as TypeId)));
    const mani = compatible.length ? [compatible[nextInt(rng, 0, compatible.length - 1)]!.id] : [];
    mani.forEach((m) => usedManifestations.add(m));
    const stat = () => nextInt(rng, 40, 160);
    return creature(`${tag}${i}`, {
      speciesId: sp.id,
      types,
      nv,
      instinct: (['atk', 'def', 'spe'] as const)[nextInt(rng, 0, 2)],
      baseStatsNV50: { ...sp.baseStatsNV50! },
      equippedTechniques: [...techs.keys()],
      equippedManifestations: mani,
      horde: techs.has('horda')
        ? [0, 1, 2].map((j) => ({ speciesId: `cadaver${j}`, atkNV50: stat(), techniqueId: corpseTechniques[nextInt(rng, 0, corpseTechniques.length - 1)]!.id }))
        : undefined,
      canTransfigure: sp.nextForm !== null && nextInt(rng, 0, 1) === 1,
    });
  });
  const cap = s.simultaneity === 'stable' ? 2 : 1;
  const deploy = creatures.slice(0, cap).map((c) => c.id);
  return { summoner: s, preparation: { creatures }, initialDeployment: deploy };
}

function checkInvariants(st: BattleState, everDefeated: Set<string>): void {
  for (const side of st.sides) {
    assert.ok(side.positions.length <= 2, 'max. 2 posiciones (12.1)');
    assert.ok(side.positions.every((p) => p.partialUid === null), 'parcial solo durante su accion');
    for (const c of side.combatants) {
      if (everDefeated.has(c.uid)) assert.equal(c.location, 'defeated', 'no regresa tras la Derrota (26.1)');
      if (c.location === 'defeated') {
        everDefeated.add(c.uid);
        assert.equal(c.hp, 0);
      }
      assert.ok(c.hp >= 0 && c.hp <= c.maxHp);
      for (const v of Object.values(c.stages)) assert.ok(v >= -6 && v <= 6);
      if (c.location !== 'field') {
        assert.ok(Object.values(c.stages).every((v) => v === 0), 'etapas a 0 fuera del campo (21.4)');
        assert.equal(c.positionId, null);
      } else {
        const pos = side.positions.find((p) => p.id === c.positionId);
        assert.equal(pos?.occupantUid, c.uid);
        assert.ok(c.hp > 0);
      }
      for (const k of ['atk', 'matk', 'def', 'mdef', 'spe'] as const) assert.ok(effStat(data, c, k) >= 1, 'stat >= 1 (21.3)');
    }
    const onField = side.combatants.filter((c) => c.location === 'field').length;
    assert.ok(onField <= side.positions.length);
  }
}

test('propiedades: invariantes de 8. en 300 combates aleatorios con todo el catalogo curado (strict)', () => {
  let ended = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = createRng(seed * 7919);
    const setups: [SideSetup, SideSetup] = [randomSetup(rng, 'a'), randomSetup(rng, 'b')];
    let st = createBattle(data, setups, { seed, config: { effectsMode: 'strict', maxRounds: 60 } });
    const everDefeated = new Set<string>();
    checkInvariants(st, everDefeated);
    while (!st.outcome) {
      const choices = ([0, 1] as SideIndex[]).flatMap((s) => randomLegalPolicy.roundStart?.(st, s, rng) ?? []);
      st = beginRound(data, st, choices);
      checkInvariants(st, everDefeated);
      const decls: Declarations = {};
      for (const s of [0, 1] as SideIndex[]) Object.assign(decls, randomLegalPolicy.declare(st, s, legalMap(data, st, s), rng));
      st = resolveRound(data, st, decls);
      checkInvariants(st, everDefeated);
    }
    if (st.outcome.reason !== 'limite de rondas (GAP-ROUND-CAP)') ended++;
  }
  assert.ok(ended > 250, `solo ${ended} combates terminaron antes del limite`);
});

test('repeticion exacta: misma semilla y escenario -> mismo log', () => {
  const rng = createRng(42);
  const setups: [SideSetup, SideSetup] = [randomSetup(rng, 'a'), randomSetup(rng, 'b')];
  const run = (seed: number) => runBattle(data, setups, [randomLegalPolicy, randomLegalPolicy], { seed, config: { effectsMode: 'strict' } });
  assert.equal(JSON.stringify(run(5).log), JSON.stringify(run(5).log));
  assert.notEqual(JSON.stringify(run(5).log), JSON.stringify(run(6).log));
});
