import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle, legalMap } from '../app/simulate.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import { beginRound, createBattle, resolveRound } from '../engine/pipeline/battle.js';
import { effStat } from '../engine/pipeline/combatant.js';
import { createRng, nextInt, type RngState } from '../engine/rng.js';
import type { BattleState, Declarations, SideIndex } from '../engine/model/battle.js';
import type { Estamento, SideSetup, TypeId } from '../engine/model/types.js';
import { TYPE_IDS } from '../engine/model/types.js';
import { creature, loadData, summoner } from './helpers.js';

const data = loadData();
const cheap = [...data.techniques.values()]
  .filter((t) => t.category !== 'special' && t.bondCost <= 12.5 && typeof t.power?.perHit === 'number' && typeof t.accuracy === 'number')
  .map((t) => t.id);

function randomSetup(rng: RngState, tag: string): SideSetup {
  const estamentos: Estamento[] = ['iniciado', 'adepto', 'invocador', 'magister', 'arconte'];
  const s = summoner(tag, estamentos[nextInt(rng, 0, estamentos.length - 1)]!);
  const n = nextInt(rng, 1, 4);
  const creatures = Array.from({ length: n }, (_, i) => {
    const type = TYPE_IDS[nextInt(rng, 0, TYPE_IDS.length - 1)] as TypeId;
    const techs = new Set<string>();
    while (techs.size < 2) techs.add(cheap[nextInt(rng, 0, cheap.length - 1)]!);
    const stat = () => nextInt(rng, 40, 160);
    return creature(`${tag}${i}`, {
      speciesId: 'riftari',
      types: [type],
      nv: nextInt(rng, 5, 100),
      baseStatsNV50: { hp: nextInt(rng, 150, 400), atk: stat(), matk: stat(), def: stat(), mdef: stat(), spe: stat() },
      equippedTechniques: [...techs],
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

test('propiedades: invariantes de 8. en 300 combates aleatorios (lenient)', () => {
  let ended = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = createRng(seed * 7919);
    const setups: [SideSetup, SideSetup] = [randomSetup(rng, 'a'), randomSetup(rng, 'b')];
    let st = createBattle(data, setups, { seed, config: { effectsMode: 'lenient', maxRounds: 60 } });
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
  const run = (seed: number) => runBattle(data, setups, [randomLegalPolicy, randomLegalPolicy], { seed, config: { effectsMode: 'lenient' } });
  assert.equal(JSON.stringify(run(5).log), JSON.stringify(run(5).log));
  assert.notEqual(JSON.stringify(run(5).log), JSON.stringify(run(6).log));
});
