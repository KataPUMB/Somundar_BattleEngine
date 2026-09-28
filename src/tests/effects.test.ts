import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combatant } from '../engine/pipeline/context.js';
import { rawDamage } from '../engine/rules/combat.js';
import type { BondedCreature } from '../engine/model/types.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, withTechniqueOverrides, FLAT_STATS } from './helpers.js';

const data = withTechniqueOverrides(loadData(), { relampago: { effects: [] } });
const tank = { ...FLAT_STATS, hp: 5000 };
const repertoire = [...data.manifestations.keys()];
const sum = (id: string, est: 'iniciado' | 'invocador' = 'iniciado') => summoner(id, est, { manifestationRepertoire: repertoire });
const at = (techniqueId: string, positionId: string) => ({ kind: 'technique' as const, techniqueId, target: { kind: 'position' as const, positionId } });
const brasal = (id: string, over: Partial<BondedCreature> = {}) => creature(id, { speciesId: 'brasal', types: ['fuego'], equippedTechniques: ['golpe_candente', 'aranazo'], ...over });
const rock = (id: string, over: Partial<BondedCreature> = {}) => creature(id, { speciesId: 'tamegona', types: ['tierra'], baseStatsNV50: tank, ...over });
// Golpe candente (PB 65, Fuego) con 100 de Ataque contra 100 de Defensa y tipo x1
const base = (m: number) => rawDamage({ power: 65, attack: 100, defense: 100, damagePcts: [(m - 1) * 100], typeMult: 1, halvings: 0, ignoreDefense: false });

function firstDamage(st: ReturnType<typeof start>, actor: string) {
  return eventsOf(st, 'damage').find((e) => e.actor === actor)!;
}

test('23.2: Combustion +25% y Juramento de las hogueras -50% se suman en M = 0,75', () => {
  const st = start(data, setup(sum('a'), [brasal('b', { equippedManifestations: ['combustion'] })]), setup(sum('z'), [rock('r', { equippedManifestations: ['juramento_de_las_hogueras'] })]));
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  const d = firstDamage(r, uid(0, 'b')).data!;
  assert.deepEqual((d.modifiers as { source: string }[]).map((m) => m.source).sort(), ['combustion', 'juramento_de_las_hogueras']);
  assert.ok(Math.abs((d.raw as number) - base(0.75)) < 1e-9);
  assert.equal(d.loss, Math.round(base(0.75)));
});

test('23.2: Devorallamas -100% anula el dano de Fuego (M = 0)', () => {
  const st = start(data, setup(sum('a'), [brasal('b')]), setup(sum('z'), [rock('r', { equippedManifestations: ['devorallamas'], types: ['fuego'], speciesId: 'riftari' })]));
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(firstDamage(r, uid(0, 'b')).data!.loss, 0);
});

test('25.1 / Calima: tecnicas de Fuego +50% mientras el Clima esta activo', () => {
  const st = start(data, setup(sum('a'), [brasal('b', { equippedManifestations: ['calima'] })]), setup(sum('z'), [rock('r')]));
  assert.equal(st.environment?.id, 'calima');
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  const d = firstDamage(r, uid(0, 'b')).data!;
  assert.deepEqual(d.modifiers, [{ pct: 50, source: 'calima' }]);
  assert.equal(d.loss, Math.round(base(1.5)));
});

test('Llovizna: las tecnicas de Rayo nunca fallan aunque el usuario este Desorientado (20.3)', () => {
  const zap = creature('zap', { speciesId: 'vajrakar', types: ['rayo'], equippedTechniques: ['relampago'], persistentStatuses: [{ id: 'desorientado', counters: { no_same_technique_consecutive: 5 } }] });
  const rain = creature('rain', { speciesId: 'undaria', types: ['agua'], baseStatsNV50: tank, equippedManifestations: ['llovizna'] });
  const st = start(data, setup(sum('a'), [zap]), setup(sum('z'), [rain]));
  assert.equal(st.environment?.id, 'llovizna');
  const r = round(data, st, { S0P0: at('relampago', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  const d = firstDamage(r, uid(0, 'zap'));
  assert.equal(d.rolls, undefined);
  assert.ok(!r.log.some((e) => e.rolls?.some((x) => x.threshold === 75)));
});

test('24.10: Desvinculado desactiva las Manifestaciones pasivas', () => {
  const b = brasal('b', { equippedManifestations: ['combustion'], persistentStatuses: [{ id: 'desvinculado', counters: { manifestations_disabled: 5, bond_communication_cut: 5 } }] });
  const st = start(data, setup(sum('a'), [b]), setup(sum('z'), [rock('r')]));
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.deepEqual(firstDamage(r, uid(0, 'b')).data!.modifiers, []);
});

test('Silencio del Vinculo: desactiva las Manifestaciones de criaturas no Miticas', () => {
  const myth = creature('myth', { speciesId: 'lernyra', types: ['mitico'], baseStatsNV50: tank, equippedManifestations: ['silencio_del_vinculo'] });
  const st = start(data, setup(sum('a'), [brasal('b', { equippedManifestations: ['combustion'] })]), setup(sum('z'), [myth]));
  assert.equal(st.environment?.id, 'silencio_del_vinculo');
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.deepEqual(firstDamage(r, uid(0, 'b')).data!.modifiers, []);
});

test('Ignicion: +50% solo a la siguiente tecnica de Fuego tras cada Entrada', () => {
  const s0 = sum('a');
  let st = start(data, setup(s0, [brasal('b', { equippedManifestations: ['ignicion'] }), brasal('b2')]), setup(sum('z'), [rock('r')]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  const fire = eventsOf(st, 'damage').filter((e) => e.actor === uid(0, 'b') && e.data!.technique === 'golpe_candente');
  assert.deepEqual(fire.map((e) => (e.data!.modifiers as unknown[]).length), [1, 0]);
  st = round(data, st, { S0P0: { kind: 'switch', incomingId: 'b2' }, S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: { kind: 'switch', incomingId: 'b' }, S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(eventsOf(st, 'bonus_consumed').length, 2);
});

test('Punto de ignicion: +50% de Fuego contra enemigos con cualquier problema de estado', () => {
  const st = start(data,
    setup(sum('a'), [brasal('b', { equippedManifestations: ['punto_de_ignicion'] })]),
    setup(sum('z'), [rock('r', { persistentStatuses: [{ id: 'saturado', counters: {} }] })]));
  const r = round(data, st, { S0P0: at('golpe_candente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(firstDamage(r, uid(0, 'b')).data!.loss, Math.round(base(1.5)));
});

test('30: una Entrada rapida aplica Enraizado y el Intercambio rival falla y se consume', () => {
  const s0 = sum('aster');
  const s1 = sum('rival');
  const riftari = creature('riftari', { baseStatsNV50: { ...FLAT_STATS, spe: 200 } });
  const raiz = creature('raiz', { speciesId: 'mairahda', types: ['planta'], equippedManifestations: ['raices_invasoras'] });
  const lento = creature('lento', { baseStatsNV50: { ...FLAT_STATS, spe: 100 } });
  const st = start(data, setup(s0, [riftari, raiz]), setup(s1, [lento, creature('otro')]));
  const r = round(data, st, { S0P0: { kind: 'switch', incomingId: 'raiz' }, S1P0: { kind: 'switch', incomingId: 'otro' } });
  assert.deepEqual(eventsOf(r, 'switch').map((e) => e.actor), [uid(0, 'riftari')]);
  const failed = eventsOf(r, 'action_failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.actor, uid(1, 'lento'));
  assert.match(String(failed[0]!.data!.reason), /enraizado/);
  assert.equal(combatant(r, uid(1, 'lento')).positionId, 'S1P0');
});

test('24.1: Mitico es inmune a Desvinculado aplicado por una Entrada', () => {
  const dark = creature('dark', { speciesId: 'amra', types: ['oscuridad'], equippedManifestations: ['ruptura_del_vinculo'] });
  const myth = creature('myth', { speciesId: 'lernyra', types: ['mitico'] });
  const st = start(data, setup(sum('a'), [dark]), setup(sum('z'), [myth]));
  assert.equal(eventsOf(st, 'status_immune').length, 1);
  assert.equal(combatant(st, uid(1, 'myth')).statuses.length, 0);
});

test('Puno preciso: hace retroceder al objetivo que no ha actuado y falla fuera del primer turno', () => {
  const p = creature('p', { equippedTechniques: ['puno_preciso', 'aranazo'] });
  let st = start(data, setup(sum('a'), [p]), setup(sum('z'), [rock('q', { equippedTechniques: ['aranazo'], baseStatsNV50: { ...tank, spe: 500 } })]));
  st = round(data, st, { S0P0: at('puno_preciso', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(eventsOf(st, 'flinch').length, 1);
  const failed = eventsOf(st, 'action_failed');
  assert.equal(failed[0]!.actor, uid(1, 'q'));
  assert.equal(eventsOf(st, 'damage').filter((e) => e.actor === uid(1, 'q')).length, 0);
  st = round(data, st, { S0P0: at('puno_preciso', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(eventsOf(st, 'technique_failed', 2).length, 1);
  assert.equal(eventsOf(st, 'damage', 2).filter((e) => e.actor === uid(0, 'p')).length, 0);
  assert.equal(eventsOf(st, 'damage', 2).filter((e) => e.actor === uid(1, 'q')).length, 1);
});

test('Puno preciso vuelve a funcionar tras retirarse y materializarse de nuevo; y via Materializacion parcial (GAP)', () => {
  const p = creature('p', { equippedTechniques: ['puno_preciso', 'aranazo'] });
  const s0 = sum('a', 'invocador');
  let st = start(data, setup(s0, [p, creature('o'), creature('part', { equippedTechniques: ['puno_preciso'] })], ['p', null]), setup(sum('z'), [rock('q', { equippedTechniques: ['aranazo'] })]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: { kind: 'switch', incomingId: 'o' }, S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: { kind: 'switch', incomingId: 'p' }, S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, {
    S0P0: at('puno_preciso', 'S1P0'),
    S0P1: { kind: 'partial', creatureId: 'part', techniqueId: 'puno_preciso', target: { kind: 'position', positionId: 'S1P0' } },
    S1P0: at('aranazo', 'S0P0'),
  });
  assert.equal(eventsOf(st, 'technique_failed', 4).length, 0);
  assert.equal(eventsOf(st, 'damage', 4).filter((e) => e.data!.technique === 'puno_preciso').length, 2);
});
