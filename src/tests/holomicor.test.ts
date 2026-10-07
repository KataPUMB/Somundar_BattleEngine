import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import { validatePreparation } from '../engine/legality/preparation.js';
import {
  HORDE_CORPSE_DAMAGE_PCT, HORDE_MAX_HITS, holomicorHpMultiplier, hordeHitPlan, hordeHits,
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

test('Vitalidad maxima del combatiente con totalCorpseCount 1, 3, 10, 30 y 100', () => {
  const base = maxHp(holo());
  assert.equal(maxHp(holo({ totalCorpseCount: 1 })), base);
  const hp = COUNTS.map((n) => maxHp(holo({ totalCorpseCount: n })));
  for (let i = 1; i < hp.length; i++) assert.ok(hp[i]! > hp[i - 1]!);
  assert.equal(hp[4], Math.round(base * holomicorHpMultiplier(100)));
  const half = creature('h', { ...holo({ totalCorpseCount: 100 }), hpCurrent: 1e9 });
  assert.equal(combatant(start(data, setup(summoner('a'), [half]), setup(summoner('b'), [wall('w')])), uid(0, 'h')).hp, hp[4]);
});

test('Horda contra un objetivo: 1 y 3 cadaveres golpean todos; 100 sufren fuerte congestion', () => {
  const hits = COUNTS.map((n) => hordeHits(n));
  assert.deepEqual(hits.slice(0, 2), [1, 3]);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i]! > hits[i - 1]!);
  assert.ok(hits[4]! <= HORDE_MAX_HITS && hits[4]! < 100 / 5);
  assert.ok(hits[3]! < 30 / 2);
});

test('Horda contra varios objetivos: el total no aumenta y se reparte por igual (13 -> 7 + 6)', () => {
  const total = (m: number, t: number) => hordeHitPlan(m, t).reduce((a, b) => a + b, 0);
  for (const m of [1, 2, 3, 10, 30, 100]) for (const t of [1, 2, 3, 4, 8]) assert.equal(total(m, t), hordeHits(m), `${m}/${t}`);
  assert.deepEqual(hordeHitPlan(100, 2), [7, 6]);
  assert.deepEqual(hordeHitPlan(100, 1), [13]);
  assert.deepEqual(hordeHitPlan(30, 2), [4, 4]);
  assert.deepEqual(hordeHitPlan(100, 3), [5, 4, 4]);
  assert.deepEqual(hordeHitPlan(3, 1), [3]);
  assert.deepEqual(hordeHitPlan(1, 2), [1, 0]);
});

test('Limites: sin NaN, negativos ni infinitos; al menos 1 impacto con 1 cadaver', () => {
  for (const n of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 1e9]) {
    for (const v of [holomicorHpMultiplier(n), hordeHits(n), ...hordeHitPlan(n, 2)]) {
      assert.ok(Number.isFinite(v) && v >= 0, `${n}: ${v}`);
    }
    assert.ok(holomicorHpMultiplier(n) >= 1);
  }
  assert.ok(hordeHits(1) >= 1);
  assert.equal(hordeHits(1e9), HORDE_MAX_HITS);
  assert.equal(hordeHitPlan(5, 0).length, 0);
});

test('Horda con 100 cadaveres contra un enemigo: impactos limitados y descriptores en ciclo', () => {
  const h = holo({ totalCorpseCount: 100, nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  const expected = hordeHits(100);
  const count = eventsOf(st, 'hit_count')[0]!.data!;
  assert.equal(count.hits, expected);
  assert.deepEqual(count.perTarget, [expected]);
  const hits = eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h'));
  assert.equal(hits.length, expected);
  assert.deepEqual(hits.map((e) => e.data!.attack), hits.map((_, i) => stableStat(corpses[i % 3]!.atkNV50, 40)));
});

test('Horda contra dos enemigos reparte los impactos 7 + 6 y cada golpe de cadaver hace un 50% menos de dano', () => {
  const h = holo({ totalCorpseCount: 100, nv: 40 });
  const foes = setup(S('b'), [wall('w'), wall('v')], ['w', 'v']);
  const st = round(data, start(data, setup(S('a'), [h]), foes), {
    S0P0: { kind: 'technique', techniqueId: 'horda', target: { kind: 'sequence', positionIds: ['S1P0', 'S1P1'] } },
    S1P0: self('enfado'),
    S1P1: self('enfado'),
  });
  const plan = hordeHitPlan(100, 2);
  assert.deepEqual(plan, [7, 6]);
  assert.deepEqual(eventsOf(st, 'hit_count')[0]!.data!.perTarget, plan);
  const hits = eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h'));
  assert.equal(hits.length, hordeHits(100));
  assert.deepEqual([0, 1].map((i) => hits.filter((e) => e.targets![0] === uid(1, i === 0 ? 'w' : 'v')).length), plan);
  for (const e of hits) assert.ok((e.data!.modifiers as { source: string; pct: number }[]).some((m) => m.source === 'horda' && m.pct === HORDE_CORPSE_DAMAGE_PCT));
});

test('Los golpes de cadaver de Horda hacen la mitad de dano que el mismo golpe sin la reduccion', () => {
  const hit = (user: BondedCreature, tech: string) => {
    const st = round(data, start(data, setup(S('a'), [user]), setup(S('b'), [wall('w')])), { S0P0: at(tech, 'S1P0'), S1P0: self('enfado') });
    return eventsOf(st, 'damage').filter((e) => e.actor === uid(0, user.id)).map((e) => e.data!.raw as number);
  };
  const horda = hit(holo({ nv: 40, horde: [{ speciesId: 'lobo', atkNV50: 150, techniqueId: 'aranazo' }], totalCorpseCount: 1 }), 'horda')[0]!;
  const normal = hit(creature('h', { speciesId: 'prueba', nv: 40, baseStatsNV50: { ...FLAT_STATS, atk: 150 }, equippedTechniques: ['aranazo'] }), 'aranazo')[0]!;
  assert.ok(Math.abs(horda / normal - 0.5) < 0.02, `${horda} / ${normal}`);
});

test('Solo cuentan los cadaveres materializados', () => {
  const h = holo({ totalCorpseCount: 100, initialMaterializedCorpseCount: 10, nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'hit_count')[0]!.data!.hits, hordeHits(10));
  assert.equal(maxHp(h), maxHp(holo({ totalCorpseCount: 100, nv: 40 })));
});

test('Compatibilidad: Holomicor sin totalCorpseCount mantiene Vitalidad x1 y 3 impactos de Horda', () => {
  const h = holo({ nv: 40 });
  assert.equal(maxHp(h), maxHp(holo({ totalCorpseCount: 1, nv: 40 })));
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h')).length, 3);
});

test('Validacion de totalCorpseCount e initialMaterializedCorpseCount', () => {
  const codes = (c: BondedCreature) => validatePreparation(setup(S('a'), [c]), data).filter((v) => v.severity === 'error').map((v) => v.code);
  assert.deepEqual(codes(holo({ totalCorpseCount: 100 })), []);
  assert.deepEqual(codes(holo({ totalCorpseCount: 0 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ totalCorpseCount: 2.5 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ totalCorpseCount: 10, initialMaterializedCorpseCount: 11 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(creature('x', { totalCorpseCount: 10 })), ['CRE_CORPSES']);
  assert.throws(() => createBattle(data, [setup(S('a'), [holo({ totalCorpseCount: -1 })]), setup(S('b'), [wall('w')])], { seed: 1 }));
});

test('Con 1 cadaver Horda sigue siendo legal y golpea una vez', () => {
  const h = holo({ totalCorpseCount: 1, horde: corpses.slice(0, 1), nv: 40 });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [wall('w')])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'h')).length, 1);
});
