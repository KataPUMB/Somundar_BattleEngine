import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../app/simulate.js';
import { colonyLine, statusLine } from '../app/format.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import { validatePreparation } from '../engine/legality/preparation.js';
import { activeManifestations, statOf } from '../engine/effects/runtime.js';
import { beginRound, DeclarationError } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import type { Action, BattleState, SideIndex } from '../engine/model/battle.js';
import type { BondedCreature, TypeId } from '../engine/model/types.js';
import { availableCorpses, hordeHits } from '../engine/rules/horde.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, FLAT_STATS } from './helpers.js';

const data = loadData();
const repertoire = [...data.manifestations.keys()];
const S = (id: string) => summoner(id, 'invocador', { amplitude: null, manifestationRepertoire: repertoire });
const at = (techniqueId: string, positionId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'position', positionId } });
const self = (techniqueId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'auto' } });
const wall = (id: string): BondedCreature => creature(id, { speciesId: 'prueba', types: ['tierra'], baseStatsNV50: { ...FLAT_STATS, hp: 100000, def: 1000 }, equippedTechniques: ['enfado'] });
const horde = [
  { speciesId: 'brasal', atkNV50: 85, techniqueId: 'embestida', count: 60 },
  { speciesId: 'gorim', atkNV50: 70, techniqueId: 'aranazo', count: 40 },
];
const holo = (over: Partial<BondedCreature> = {}) =>
  creature('h', {
    speciesId: 'holomicor', types: ['oscuridad', 'planta'] as TypeId[], nv: 100, equippedTechniques: ['horda'], horde,
    totalCorpseCount: 100, initialMaterializedCorpseCount: 3, ...over,
  });
const bench = () => creature('x', { equippedTechniques: ['aranazo'] });
const fight = (h = holo(), seed = 1) => start(data, setup(S('a'), [h, bench()], ['h']), setup(S('b'), [wall('w')]), seed);
const attack = (extra: Record<string, Action> = {}) => ({ S0P0: at('horda', 'S1P0'), S1P0: self('enfado'), ...extra });
const colony = (st: BattleState) => combatant(st, uid(0, 'h')).colony!;
const lastCount = (st: BattleState) => eventsOf(st, 'hit_count', st.round).find((e) => e.actor === uid(0, 'h'))!.data!;
const grow = (to: number | 'all') => [{ side: 0 as SideIndex, creatureId: 'h', materializeCorpses: to }];

test('1. Empieza con 3 de 100: sigue siendo un unico combatiente', () => {
  const st = fight();
  assert.deepEqual(colony(st), { total: 100, destroyed: 0, materialized: 3 });
  assert.equal(st.sides[0].combatants.length, 2);
  assert.equal(availableCorpses(colony(st)), 100);
});

test('2. Mantener 3: Horda calcula 3 impactos y la colonia no cambia entre rondas', () => {
  let st = fight();
  for (let i = 0; i < 2; i++) {
    st = round(data, st, attack());
    assert.equal(lastCount(st).corpses, 3);
    assert.equal(lastCount(st).hits, 3);
    assert.equal(colony(st).materialized, 3);
  }
});

test('3. Subir de 3 a 10 al empezar la ronda sin gastar la accion', () => {
  const st = round(data, fight(), attack(), grow(10));
  assert.equal(colony(st).materialized, 10);
  assert.equal(lastCount(st).corpses, 10);
  assert.equal(lastCount(st).hits, hordeHits(10));
  const ev = eventsOf(st, 'colony_materialize')[0]!.data!;
  assert.deepEqual([ev.from, ev.to, ev.available, ev.total], [3, 10, 100, 100]);
  assert.ok(eventsOf(st, 'damage').some((e) => e.actor === uid(0, 'h')), 'Holomicor sigue actuando esa ronda');
});

test('4. Subir de 10 a 100', () => {
  let st = round(data, fight(), attack(), grow(10));
  st = round(data, st, attack(), grow(100));
  assert.equal(colony(st).materialized, 100);
  assert.equal(lastCount(st).hits, hordeHits(100));
});

test('5. Materializar todos: de 3 a los 100 disponibles', () => {
  const st = round(data, fight(), attack(), grow('all'));
  assert.equal(colony(st).materialized, 100);
  assert.equal(eventsOf(st, 'colony_materialize')[0]!.data!.to, 100);
});

test('6. Reducir consume la accion (regla de la Retirada voluntaria) y se mantiene despues', () => {
  let st = fight(holo({ initialMaterializedCorpseCount: 40 }));
  st = round(data, st, { S0P0: { kind: 'corpses', count: 5 }, S1P0: self('enfado') });
  assert.equal(colony(st).materialized, 5);
  assert.equal(eventsOf(st, 'colony_withdraw')[0]!.data!.from, 40);
  assert.equal(eventsOf(st, 'hit_count').length, 0, 'sin Horda: la accion se ha consumido');
  assert.equal(combatant(st, uid(0, 'h')).location, 'field');
  st = round(data, st, attack());
  assert.equal(lastCount(st).corpses, 5);
  assert.equal(lastCount(st).hits, hordeHits(5));
});

test('6b. Un Holomicor Enraizado no puede reducir su materializacion', () => {
  const rooted = holo({ initialMaterializedCorpseCount: 40, persistentStatuses: [{ id: 'enraizado', counters: { no_voluntary_withdraw: 2 } }] });
  const st = fight(rooted);
  assert.throws(() => round(data, st, { S0P0: { kind: 'corpses', count: 5 }, S1P0: self('enfado') }), DeclarationError);
});

test('7. Horda usa el numero de cuerpos presentes: 3 y 100 son estados tacticos distintos de la misma criatura', () => {
  const small = round(data, fight(), attack());
  const full = round(data, fight(holo({ initialMaterializedCorpseCount: 100 })), attack());
  assert.equal(lastCount(small).hits, 3);
  assert.equal(lastCount(full).hits, hordeHits(100));
  assert.ok(lastCount(full).hits as number > 4 * (lastCount(small).hits as number) && lastCount(full).hits as number < 100 / 5);
  assert.equal(combatant(small, uid(0, 'h')).maxHp, combatant(full, uid(0, 'h')).maxHp);
  assert.equal(small.sides[0].combatants.length, full.sides[0].combatants.length);
  const bodies = (st: BattleState) => eventsOf(st, 'horde_corpse', st.round).map((e) => e.data!.species);
  assert.deepEqual(bodies(small), ['brasal', 'brasal', 'brasal']);
  assert.equal(bodies(full).length, hordeHits(100));
});

test('7b. Las Manifestaciones de la colonia solo estan activas con todos los cadaveres materializados', () => {
  const withManifestations = (n: number) => holo({ initialMaterializedCorpseCount: n, equippedManifestations: ['corteza_ancestral'] });
  const ctxOf = (st: BattleState) => ({ data, st, controllers: {} });
  const partial = fight(withManifestations(3));
  const full = fight(withManifestations(100));
  assert.equal(activeManifestations(ctxOf(partial), combatant(partial, uid(0, 'h'))).length, 0);
  assert.equal(activeManifestations(ctxOf(full), combatant(full, uid(0, 'h'))).length, 1);
  const def = (st: BattleState) => statOf(ctxOf(st), combatant(st, uid(0, 'h')), 'def');
  assert.ok(def(full) > def(partial) * 1.4);
  const grown = round(data, partial, attack(), grow('all'));
  assert.equal(activeManifestations(ctxOf(grown), combatant(grown, uid(0, 'h'))).length, 1);
});

test('8. Cambiar de criatura: Holomicor vuelve al Intermedio con todos sus cuerpos fuera', () => {
  const st = round(data, fight(), { S0P0: { kind: 'switch', incomingId: 'x' }, S1P0: self('enfado') });
  const h = combatant(st, uid(0, 'h'));
  assert.equal(h.location, 'intermedio');
  assert.equal(h.colony!.materialized, 0);
  assert.equal(h.colony!.total, 100);
  assert.equal(st.sides[0].combatants.length, 2);
  assert.match(colonyLine(h)!, /Intermedio/);
});

test('9. Volver a desplegar Holomicor: elige de nuevo cuantos cuerpos, no restaura el numero anterior', () => {
  let st = round(data, fight(holo({ initialMaterializedCorpseCount: 40 })), { S0P0: { kind: 'switch', incomingId: 'x' }, S1P0: self('enfado') });
  const back = { S0P0: { kind: 'switch', incomingId: 'h' } as Action, S1P0: self('enfado') };
  const asked: number[][] = [];
  const chosen = round(data, st, back, [], { chooseCorpses: (_st, _uid, max, suggested) => (asked.push([max, suggested]), 17) });
  assert.deepEqual(asked, [[100, 40]]);
  assert.equal(colony(chosen).materialized, 17);
  st = round(data, st, back);
  assert.equal(colony(st).materialized, 40, 'sin eleccion usa el numero habitual');
  const clamped = round(data, round(data, fight(), { S0P0: { kind: 'switch', incomingId: 'x' }, S1P0: self('enfado') }), back, [], { chooseCorpses: () => 9999 });
  assert.equal(colony(clamped).materialized, 100);
});

test('10. No se puede materializar mas cadaveres que los disponibles', () => {
  const st = fight(holo({ destroyedCorpseCount: 6 }));
  assert.deepEqual(colony(st), { total: 100, destroyed: 6, materialized: 3 });
  assert.equal(availableCorpses(colony(st)), 94);
  assert.throws(() => beginRound(data, st, grow(95)), DeclarationError);
  assert.throws(() => beginRound(data, fight(), grow(101)), DeclarationError);
  assert.equal(colony(round(data, st, attack(), grow('all'))).materialized, 94);
  const bad = validatePreparation(setup(S('a'), [holo({ destroyedCorpseCount: 6, initialMaterializedCorpseCount: 95 })]), data);
  assert.deepEqual(bad.filter((v) => v.severity === 'error').map((v) => v.code), ['CRE_CORPSES']);
});

test('11. Cantidades negativas, cero, no enteras o que no aumentan se rechazan; reducir hasta 1 es valido', () => {
  const st = fight(holo({ initialMaterializedCorpseCount: 10 }));
  for (const bad of [0, -3, 2.5, 10, 4]) assert.throws(() => beginRound(data, st, grow(bad)), DeclarationError, `${bad}`);
  for (const bad of [0, -1, 10, 11, 2.5]) {
    assert.throws(() => round(data, st, { S0P0: { kind: 'corpses', count: bad }, S1P0: self('enfado') }), DeclarationError, `${bad}`);
  }
  const one = round(data, st, { S0P0: { kind: 'corpses', count: 1 }, S1P0: self('enfado') });
  assert.equal(colony(one).materialized, 1);
  const only = round(data, one, attack());
  assert.equal(lastCount(only).hits, 1);
  assert.throws(() => round(data, only, { S0P0: { kind: 'corpses', count: 1 }, S1P0: self('enfado') }), DeclarationError);
  assert.throws(() => beginRound(data, start(data, setup(S('a'), [bench(), holo()], ['x']), setup(S('b'), [wall('w')])), grow(10)), DeclarationError);
  assert.throws(() => beginRound(data, start(data, setup(S('a'), [creature('n')]), setup(S('b'), [wall('w')])), [{ side: 0, creatureId: 'n', materializeCorpses: 5 }]), DeclarationError);
});

test('12. El estado se conserva entre rondas: 3 -> 10 -> 10 -> 100', () => {
  let st = fight();
  const seen: number[] = [colony(st).materialized];
  for (const decision of [grow(10), [], grow('all'), []]) {
    st = round(data, st, attack(), decision);
    seen.push(colony(st).materialized);
  }
  assert.deepEqual(seen, [3, 10, 10, 100, 100]);
  assert.deepEqual(eventsOf(st, 'hit_count').map((e) => e.data!.corpses), [10, 10, 100, 100]);
});

test('Salida: Cadaveres: 12 / 100 y, con destruidos, materializados / disponibles / totales', () => {
  const st = round(data, fight(), attack(), grow(12));
  const h = combatant(st, uid(0, 'h'));
  assert.equal(colonyLine(h), 'Cadaveres: 12 / 100');
  assert.match(statusLine(h, data), /NV 100 \| Cadaveres: 12 \/ 100/);
  const hurt = combatant(fight(holo({ destroyedCorpseCount: 6 })), uid(0, 'h'));
  assert.equal(colonyLine(hurt), 'Cadaveres materializados: 3 | disponibles: 94 | totales: 100');
  assert.equal(colonyLine(combatant(fight(), uid(0, 'x'))), null);
});

test('Validacion de la composicion de la colonia', () => {
  const codes = (c: BondedCreature) => validatePreparation(setup(S('a'), [c]), data).filter((v) => v.severity === 'error').map((v) => v.code);
  assert.deepEqual(codes(holo()), []);
  assert.deepEqual(codes(holo({ totalCorpseCount: 99 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ destroyedCorpseCount: 100 })), ['CRE_CORPSES']);
  assert.deepEqual(codes(holo({ horde: [{ ...horde[0]!, count: 0 }, horde[1]!] })), ['CRE_CORPSES', 'CRE_CORPSES']);
  assert.deepEqual(codes(creature('y', { initialMaterializedCorpseCount: 3 })), ['CRE_CORPSES']);
});

test('Invariantes: materializados <= disponibles <= totales en combates completos con la IA aleatoria', () => {
  const sideA = setup(S('a'), [holo(), bench()], ['h', 'x']);
  const sideB = setup(S('b'), [creature('p', { equippedTechniques: ['aranazo', 'enfado'] }), creature('q', { equippedTechniques: ['aranazo'] })], ['p', 'q']);
  let sawGrowth = false;
  for (let seed = 1; seed <= 25; seed++) {
    runBattle(data, [sideA, sideB], [randomLegalPolicy, randomLegalPolicy], {
      seed,
      config: { maxRounds: 15 },
      onUpdate: (st) => {
        for (const c of st.sides.flatMap((s) => s.combatants)) {
          if (!c.colony) continue;
          const col = c.colony;
          assert.ok(col.materialized >= 0 && col.materialized <= availableCorpses(col) && availableCorpses(col) <= col.total);
          assert.equal(c.location === 'field', col.materialized >= 1, `${c.uid}: ${c.location} con ${col.materialized}`);
          if (col.materialized > 3) sawGrowth = true;
        }
      },
    });
  }
  assert.ok(sawGrowth, 'la IA aleatoria llega a materializar mas cadaveres');
});
