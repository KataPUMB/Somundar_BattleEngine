import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import { validatePreparation } from '../engine/legality/preparation.js';
import {
  HORDE_MAX_HITS_PER_TARGET, holomicorHpMultiplier, hordeHitPlan, hordeHitsPerTarget, materializedCorpses,
} from '../engine/rules/horde.js';
import { stableStat } from '../engine/rules/stats.js';
import type { Action } from '../engine/model/battle.js';
import type { BondedCreature, TypeId } from '../engine/model/types.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, FLAT_STATS } from './helpers.js';

const data = loadData();
const COUNTS = [1, 3, 10, 30, 100];
const at = (techniqueId: string, positionId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'position', positionId } });
const self = (techniqueId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'auto' } });
const wall = (id: string): BondedCreature => creature(id, { speciesId: 'prueba', types: ['tierra'], baseStatsNV50: { ...FLAT_STATS, hp: 100000, def: 1000 }, equippedTechniques: ['enfado'] });
const corpses = [
  { speciesId: 'lobo', atkNV50: 150, techniqueId: 'aranazo' },
  { speciesId: 'oso', atkNV50: 200, techniqueId: 'aranazo' },
  { speciesId: 'jabali', atkNV50: 90, techniqueId: 'aranazo' },
];
const holo = (over: Partial<BondedCreature> = {}) =>
  creature('h', { speciesId: 'holomicor', types: ['oscuridad', 'planta'] as TypeId[], equippedTechniques: ['horda'], horde: corpses, ...over });
const maxHp = (c: BondedCreature) => combatant(start(data, setup(summoner('a'), [c]), setup(summoner('b'), [wall('w')])), uid(0, c.id)).maxHp;
const S = (id: string) => summoner(id, 'invocador', { amplitude: null });

test('Vitalidad de la colonia: x1 con 1 cadaver, estrictamente creciente y sublineal', () => {
  const mult = COUNTS.map((n) => holomicorHpMultiplier(n));
  assert.equal(mult[0], 1);
  assert.equal(holomicorHpMultiplier(), 1);
  for (let i = 1; i < mult.length; i++) assert.ok(mult[i]! > mult[i - 1]!, `${COUNTS[i]}`);
  assert.ok(mult[4]! < 15 && mult[4]! > 8, 'raid boss sin destruir la escala');
  assert.ok(mult[4]! < COUNTS[4]! / 5);
});

test('Vitalidad maxima del combatiente con corpseCount 1, 3, 10, 30 y 100', () => {
  const base = maxHp(holo());
  assert.equal(maxHp(holo({ corpseCount: 1 })), base);
  const hp = COUNTS.map((n) => maxHp(holo({ corpseCount: n })));
  for (let i = 1; i < hp.length; i++) assert.ok(hp[i]! > hp[i - 1]!);
  assert.equal(hp[4], Math.round(base * holomicorHpMultiplier(100)));
  const half = creature('h', { ...holo({ corpseCount: 100 }), hpCurrent: 1e9 });
  assert.equal(combatant(start(data, setup(summoner('a'), [half]), setup(summoner('b'), [wall('w')])), uid(0, 'h')).hp, hp[4]);
});

test('Horda contra un objetivo: 1 y 3 cadaveres golpean todos; 100 sufren fuerte congestion', () => {
  const hits = COUNTS.map((n) => hordeHitsPerTarget(n));
  assert.deepEqual(hits.slice(0, 2), [1, 3]);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i]! > hits[i - 1]!);
  assert.ok(hits[4]! <= HORDE_MAX_HITS_PER_TARGET && hits[4]! < 100 / 5);
  assert.ok(hits[3]! < 30 / 2);
});

test('Horda contra varios objetivos: mas impactos totales, nunca mas que cadaveres presentes', () => {
  const total = (m: number, t: number) => hordeHitPlan(m, t).reduce((a, b) => a + b, 0);
  assert.ok(total(100, 2) > total(100, 1));
  assert.ok(total(100, 4) > total(100, 2));
  assert.ok(total(100, 20) > total(100, 4));
  for (const m of [1, 2, 3, 10, 30, 100]) for (const t of [1, 2, 3, 4, 8]) assert.ok(total(m, t) <= m && total(m, t) >= 1, `${m}/${t}`);
  assert.deepEqual(hordeHitPlan(3, 1), [3]);
  assert.deepEqual(hordeHitPlan(1, 2), [1, 0]);
});

test('Limites: sin NaN, negativos ni infinitos; al menos 1 impacto con 1 cadaver', () => {
  for (const n of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e9]) {
    for (const v of [holomicorHpMultiplier(n), hordeHitsPerTarget(n), ...hordeHitPlan(n, 2), materializedCorpses({ corpseCount: n })]) {
      assert.ok(Number.isFinite(v) && v >= 0, `${n}: ${v}`);
    }
    assert.ok(holomicorHpMultiplier(n) >= 1);
  }
  assert.ok(hordeHitsPerTarget(1) >= 1);
  assert.equal(hordeHitsPerTarget(1e9), HORDE_MAX_HITS_PER_TARGET);
  assert.equal(hordeHitPlan(5, 0).length, 0);
});

test('Horda con 100 cadaveres contra un enemigo: impactos limitados y descriptores en ciclo', () => {
  const h = holo({ corpseCount: 100, nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  const expected = hordeHitsPerTarget(100);
  const count = eventsOf(st, 'hit_count')[0]!.data!;
  assert.equal(count.hits, expected);
  assert.deepEqual(count.perTarget, [expected]);
  const hits = eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h'));
  assert.equal(hits.length, expected);
  assert.deepEqual(hits.map((e) => e.data!.attack), hits.map((_, i) => stableStat(corpses[i % 3]!.atkNV50, 40)));
});

test('Horda contra dos enemigos reparte los cadaveres y produce mas impactos', () => {
  const h = holo({ corpseCount: 100, nv: 40 });
  const foes = setup(S('b'), [wall('w'), wall('v')], ['w', 'v']);
  const st = round(data, start(data, setup(S('a'), [h]), foes), {
    S0P0: { kind: 'technique', techniqueId: 'horda', target: { kind: 'sequence', positionIds: ['S1P0', 'S1P1'] } },
    S1P0: self('enfado'),
    S1P1: self('enfado'),
  });
  const plan = hordeHitPlan(100, 2);
  assert.deepEqual(eventsOf(st, 'hit_count')[0]!.data!.perTarget, plan);
  const hits = eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h'));
  assert.equal(hits.length, plan[0]! + plan[1]!);
  assert.ok(hits.length > hordeHitsPerTarget(100));
  assert.deepEqual([0, 1].map((i) => hits.filter((e) => e.targets![0] === uid(1, i === 0 ? 'w' : 'v')).length), plan);
});

test('Solo cuentan los cadaveres materializados', () => {
  const h = holo({ corpseCount: 100, materializedCorpseCount: 10, nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'hit_count')[0]!.data!.hits, hordeHitsPerTarget(10));
  assert.equal(maxHp(h), maxHp(holo({ corpseCount: 100, nv: 40 })));
});

test('Compatibilidad: Holomicor sin corpseCount mantiene Vitalidad x1 y 3 impactos de Horda', () => {
  const h = holo({ nv: 40 });
  assert.equal(maxHp(h), maxHp(holo({ corpseCount: 1, nv: 40 })));
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h')).length, 3);
});

test('Validacion de corpseCount y materializedCorpseCount', () => {
  const codes = (c: BondedCreature) => validatePreparation(setup(S('a'), [c]), data).filter((v) => v.severity === 'error').map((v) => v.code);
  assert.deepEqual(codes(holo({ corpseCount: 100 })), []);
  assert.deepEqual(codes(holo({ corpseCount: 0 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ corpseCount: 2.5 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ corpseCount: 10, materializedCorpseCount: 11 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(creature('x', { corpseCount: 10 })), ['CRE_CORPSES']);
  assert.throws(() => createBattle(data, [setup(S('a'), [holo({ corpseCount: -1 })]), setup(S('b'), [wall('w')])], { seed: 1 }));
});

test('Con 1 cadaver Horda sigue siendo legal y golpea una vez', () => {
  const h = holo({ corpseCount: 1, horde: corpses.slice(0, 1), nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h')).length, 1);
});
