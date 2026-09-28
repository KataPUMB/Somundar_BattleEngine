import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginRound, DeclarationError, resolveRound } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, withoutOverride, withTechniqueOverrides, FLAT_STATS } from './helpers.js';

const data = withTechniqueOverrides(loadData(), {
  abrazo_voltaico: { effects: [] },
  tres_mordiscos: { effects: [] },
  relampago: { effects: [] },
  mordisco: { effects: [], charge: true },
});
const hit = (target: string) => ({ kind: 'technique' as const, techniqueId: 'aranazo', target: { kind: 'position' as const, positionId: target } });
const tank = { ...FLAT_STATS, hp: 5000 };

test('13.4 / 28.1 / 29: despliegue por Velocidad y Entradas reunidas despues, tambien por Velocidad', () => {
  const s0 = summoner('ana', 'iniciado', { manifestationRepertoire: ['calima'] });
  const s1 = summoner('bea', 'iniciado', { manifestationRepertoire: ['llovizna'] });
  const slow = creature('lento', { baseStatsNV50: { ...FLAT_STATS, spe: 50 }, equippedManifestations: ['calima'] });
  const fast = creature('rapido', { speciesId: 'undaria', types: ['agua'], baseStatsNV50: { ...FLAT_STATS, spe: 150 }, equippedManifestations: ['llovizna'] });
  const st = start(data, setup(s0, [slow]), setup(s1, [fast]));
  const types = st.log.map((e) => `${e.type}:${e.actor ?? ''}`).filter((x) => /^(materialize|manifestation|environment_set)/.test(x));
  assert.deepEqual(types, [
    'materialize:1:rapido', 'materialize:0:lento',
    'manifestation:1:rapido', 'environment_set:1:rapido', 'manifestation:0:lento', 'environment_set:0:lento',
  ]);
  assert.equal(st.environment?.id, 'calima');
  assert.equal(st.environment?.sourceUid, uid(0, 'lento'));
  assert.equal(st.log.at(-1)?.type, 'deployment_complete');
});

test('16.2: Intercambios ordenados por Velocidad de la criatura saliente', () => {
  const s = summoner('x', 'iniciado');
  const st = start(data,
    setup(s, [creature('a', { baseStatsNV50: { ...FLAT_STATS, spe: 80 } }), creature('a2')]),
    setup(s, [creature('b', { baseStatsNV50: { ...FLAT_STATS, spe: 120 } }), creature('b2')]));
  const r = round(data, st, { S0P0: { kind: 'switch', incomingId: 'a2' }, S1P0: { kind: 'switch', incomingId: 'b2' } });
  assert.deepEqual(eventsOf(r, 'switch').map((e) => e.actor), [uid(1, 'b'), uid(0, 'a')]);
  assert.equal(combatant(r, uid(0, 'a')).location, 'intermedio');
  assert.equal(combatant(r, uid(0, 'a2')).positionId, 'S0P0');
});

test('31 / 14.2: la tecnica dirigida a la posicion de Risco impacta al nuevo ocupante', () => {
  const s = summoner('x', 'iniciado');
  const st = start(data, setup(s, [creature('atacante')]), setup(s, [creature('risco', { baseStatsNV50: { ...FLAT_STATS, spe: 200 } }), creature('relevo')]));
  const r = round(data, st, { S0P0: hit('S1P0'), S1P0: { kind: 'switch', incomingId: 'relevo' } });
  const dmg = eventsOf(r, 'damage');
  assert.equal(dmg.length, 1);
  assert.deepEqual(dmg[0]!.targets, [uid(1, 'relevo')]);
  assert.equal(combatant(r, uid(1, 'risco')).hp, combatant(r, uid(1, 'risco')).maxHp);
});

test('16.1 / 16.6: la criatura que entra no hereda la accion ni actua esa ronda', () => {
  const s = summoner('x', 'iniciado');
  const st = start(data, setup(s, [creature('a', { hpCurrent: 1 }), creature('a2')]), setup(s, [creature('b', { baseStatsNV50: { ...FLAT_STATS, spe: 200 } })]));
  const r = round(data, st, { S0P0: hit('S1P0'), S1P0: hit('S0P0') });
  assert.equal(combatant(r, uid(0, 'a')).location, 'defeated');
  assert.equal(combatant(r, uid(0, 'a2')).positionId, 'S0P0');
  assert.equal(eventsOf(r, 'action_failed').length, 1);
  assert.equal(eventsOf(r, 'damage').length, 1);
  const fr = eventsOf(r, 'forced_replacement')[0]!;
  assert.ok(fr.id > eventsOf(r, 'technique_end')[0]!.id);
});

test('32: Materializacion parcial sin Manifestaciones, misma Prioridad y vuelta al Intermedio', () => {
  const s0 = summoner('inv', 'invocador', { manifestationRepertoire: ['calima'] });
  const s1 = summoner('riv', 'iniciado');
  const a = creature('a');
  const nimbaro = creature('nimbaro', { baseStatsNV50: { ...FLAT_STATS, spe: 300 }, equippedManifestations: ['calima'] });
  const rival = creature('rival', { speciesId: 'vajrakar', types: ['rayo'], equippedTechniques: ['relampago'] });
  const st = start(data, setup(s0, [a, nimbaro], ['a', null]), setup(s1, [rival]));
  const r = round(data, st, {
    S0P0: hit('S1P0'),
    S0P1: { kind: 'partial', creatureId: 'nimbaro', techniqueId: 'aranazo', target: { kind: 'position', positionId: 'S1P0' } },
    S1P0: { kind: 'technique', techniqueId: 'relampago', target: { kind: 'position', positionId: 'S0P0' } },
  });
  const order = eventsOf(r, 'action_order')[0]!.data!.order as string[];
  assert.deepEqual(order, [uid(1, 'rival'), uid(0, 'nimbaro'), uid(0, 'a')]);
  assert.equal(eventsOf(r, 'partial_materialization').length, 1);
  assert.equal(r.log.filter((e) => e.actor === uid(0, 'nimbaro') && e.type.startsWith('manifestation')).length, 0);
  assert.ok(eventsOf(r, 'damage').some((e) => e.actor === uid(0, 'nimbaro')));
  assert.equal(combatant(r, uid(0, 'nimbaro')).location, 'intermedio');
  const p1 = r.sides[0].positions.find((p) => p.id === 'S0P1')!;
  assert.equal(p1.occupantUid, null);
  assert.equal(p1.partialUid, null);
});

test('12.1: la Materializacion parcial no esta disponible sin posicion libre ni para quien no la domina', () => {
  const s = summoner('ini', 'iniciado');
  const st = beginRound(data, start(data, setup(s, [creature('a'), creature('b')]), setup(s, [creature('c')])));
  assert.throws(() => resolveRound(data, st, {
    S0P0: hit('S1P0'),
    S0P1: { kind: 'partial', creatureId: 'b', techniqueId: 'aranazo', target: { kind: 'position', positionId: 'S1P0' } },
    S1P0: hit('S0P0'),
  }), DeclarationError);
});

test('17: Esquivas consecutivas 100 / 50 / 12,5 / 0 y reinicio tras otra accion', () => {
  const s = summoner('x', 'iniciado');
  let st = start(data, setup(s, [creature('esq', { baseStatsNV50: tank })]), setup(s, [creature('atk', { baseStatsNV50: tank })]), 7);
  const plan = ['dodge', 'dodge', 'dodge', 'dodge', 'hit', 'dodge'];
  for (const p of plan) st = round(data, st, { S0P0: p === 'dodge' ? { kind: 'dodge' } : hit('S1P0'), S1P0: hit('S0P0') });
  const chances = st.log.filter((e) => e.type.startsWith('dodge_')).map((e) => e.data!.chance);
  assert.deepEqual(chances, [100, 50, 12.5, 0, 100]);
  const r1 = st.log.filter((e) => e.round === 1);
  assert.ok(r1.some((e) => e.type === 'dodged'));
  assert.ok(!r1.some((e) => e.type === 'damage' && e.targets?.[0] === uid(0, 'esq')));
});

test('19.4: multigolpe de Objetivo unico se detiene al derrotar; Reemplazo solo al final', () => {
  const s = summoner('x', 'iniciado');
  const ful = creature('ful', { speciesId: 'fulguilla', types: ['rayo'], equippedTechniques: ['abrazo_voltaico'], baseStatsNV50: { ...FLAT_STATS, spe: 200 } });
  const st = start(data, setup(s, [ful]), setup(s, [creature('v', { hpCurrent: 1 }), creature('r', { baseStatsNV50: tank })]));
  const r = round(data, st, { S0P0: { kind: 'technique', techniqueId: 'abrazo_voltaico', target: { kind: 'position', positionId: 'S1P0' } }, S1P0: hit('S0P0') });
  const dmg = eventsOf(r, 'damage').filter((e) => e.actor === uid(0, 'ful'));
  assert.equal(dmg.length, 1);
  const end = eventsOf(r, 'technique_end')[0]!;
  const fr = eventsOf(r, 'forced_replacement')[0]!;
  assert.ok(fr.id > end.id);
  assert.equal(fr.actor, uid(1, 'r'));
});

test('19.4: Multiobjetivo sigue la secuencia declarada; los impactos nunca golpean al Reemplazo', () => {
  const s0 = summoner('x', 'iniciado');
  const s1 = summoner('y', 'invocador');
  const nir = creature('nir', { speciesId: 'nirdih', types: ['mitico'], equippedTechniques: ['tres_mordiscos'], baseStatsNV50: { ...FLAT_STATS, spe: 200 } });
  const foes = [creature('p', { hpCurrent: 1 }), creature('q', { hpCurrent: 1 }), creature('r1', { baseStatsNV50: tank }), creature('r2', { baseStatsNV50: tank })];
  const st = start(data, setup(s0, [nir]), setup(s1, foes, ['p', 'q']));
  const r = round(data, st, {
    S0P0: { kind: 'technique', techniqueId: 'tres_mordiscos', target: { kind: 'sequence', positionIds: ['S1P0', 'S1P1'] } },
    S1P0: hit('S0P0'),
    S1P1: hit('S0P0'),
  });
  const dmg = eventsOf(r, 'damage').filter((e) => e.actor === uid(0, 'nir'));
  assert.deepEqual(dmg.map((e) => e.targets![0]), [uid(1, 'p'), uid(1, 'q')]);
  const end = eventsOf(r, 'technique_end')[0]!;
  const frs = eventsOf(r, 'forced_replacement');
  assert.equal(frs.length, 2);
  assert.ok(frs.every((e) => e.id > end.id));
  assert.equal(eventsOf(r, 'action_failed').length, 2);
});

test('19.5: tecnica de carga; la carga se pierde al salir', () => {
  const s = summoner('x', 'iniciado');
  const c = creature('c', { equippedTechniques: ['mordisco'] });
  let st = start(data, setup(s, [c, creature('c2')]), setup(s, [creature('d', { baseStatsNV50: tank })]));
  const bite = { kind: 'technique' as const, techniqueId: 'mordisco', target: { kind: 'position' as const, positionId: 'S1P0' } };
  st = round(data, st, { S0P0: bite, S1P0: hit('S0P0') });
  assert.equal(eventsOf(st, 'charge_start').length, 1);
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'c')).length, 0);
  st = round(data, st, { S0P0: bite, S1P0: hit('S0P0') });
  assert.equal(eventsOf(st, 'damage', 2).filter((e) => e.actor === uid(0, 'c')).length, 1);
  st = round(data, st, { S0P0: bite, S1P0: hit('S0P0') });
  st = round(data, st, { S0P0: { kind: 'switch', incomingId: 'c2' }, S1P0: hit('S0P0') });
  assert.equal(eventsOf(st, 'exit', 4)[0]!.data!.chargeLost, true);
  assert.equal(combatant(st, uid(0, 'c')).charging, null);
});

test('24.2-24.5: Quemado al cierre; contadores solo avanzan materializada; Enraizado impide Intercambio', () => {
  const s = summoner('x', 'iniciado');
  const burnt = creature('q', { speciesId: 'undaria', types: ['agua'], persistentStatuses: [{ id: 'quemado', counters: {} }, { id: 'enraizado', counters: { no_voluntary_withdraw: 2 } }] });
  const reserve = creature('res', { speciesId: 'undaria', types: ['agua'], persistentStatuses: [{ id: 'enraizado', counters: { no_voluntary_withdraw: 2 } }] });
  let st = start(data, setup(s, [burnt, reserve]), setup(s, [creature('z', { baseStatsNV50: tank })]));
  assert.throws(() => round(data, st, { S0P0: { kind: 'switch', incomingId: 'res' }, S1P0: hit('S0P0') }), DeclarationError);
  st = round(data, st, { S0P0: hit('S1P0'), S1P0: hit('S0P0') });
  const dot = eventsOf(st, 'status_damage')[0]!;
  assert.equal(dot.data!.loss, Math.round(300 * 0.0625));
  assert.equal(combatant(st, uid(0, 'q')).statuses.find((x) => x.id === 'enraizado')!.counters.no_voluntary_withdraw, 1);
  assert.equal(combatant(st, uid(0, 'res')).statuses[0]!.counters.no_voluntary_withdraw, 2);
});

test('13.2 / 28.6.19: segunda posicion temporal del Adepto (supuesto por defecto: 1 ronda)', () => {
  const s0 = summoner('ad', 'adepto');
  const s1 = summoner('y', 'iniciado');
  const st0 = start(data, setup(s0, [creature('a'), creature('b')]), setup(s1, [creature('z', { baseStatsNV50: tank })]));
  const opened = beginRound(data, st0, [{ side: 0, creatureId: 'b' }]);
  assert.equal(opened.sides[0].positions.length, 2);
  const r = resolveRound(data, opened, { S0P0: hit('S1P0'), S0P1: hit('S1P0'), S1P0: hit('S0P0') });
  assert.equal(eventsOf(r, 'position_closed').length, 1);
  assert.equal(r.sides[0].positions.length, 1);
  assert.equal(combatant(r, uid(0, 'b')).location, 'intermedio');
});

test('modo strict: una tecnica sin efectos curados no se puede declarar', () => {
  const s = summoner('x', 'iniciado');
  const raw = withoutOverride(data, 'bola_de_fuego');
  const st = beginRound(raw, start(raw, setup(s, [creature('a', { equippedTechniques: ['bola_de_fuego'] })]), setup(s, [creature('b')])));
  assert.throws(() => resolveRound(raw, st, { S0P0: { kind: 'technique', techniqueId: 'bola_de_fuego', target: { kind: 'position', positionId: 'S1P0' } }, S1P0: hit('S0P0') }), /sin efectos curados/);
});

test('26.2: derrotar a toda la Preparacion termina el combate', () => {
  const s = summoner('x', 'iniciado');
  const st = start(data, setup(s, [creature('a', { baseStatsNV50: { ...FLAT_STATS, spe: 200 } })]), setup(s, [creature('b', { hpCurrent: 1 })]));
  const r = round(data, st, { S0P0: hit('S1P0'), S1P0: hit('S0P0') });
  assert.deepEqual(r.outcome, { kind: 'victory', winner: 0, reason: 'todas las criaturas de la Preparacion derrotadas (26.2)' });
  assert.equal(r.phase, 'ended');
});

test('el estado de entrada no se muta (copia estructural)', () => {
  const s = summoner('x', 'iniciado');
  const st = start(data, setup(s, [creature('a')]), setup(s, [creature('b')]));
  const snapshot = JSON.stringify(st);
  round(data, st, { S0P0: hit('S1P0'), S1P0: hit('S0P0') });
  assert.equal(JSON.stringify(st), snapshot);
});
