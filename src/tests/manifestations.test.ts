import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginRound, DeclarationError, resolveRound } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import { effStat } from '../engine/pipeline/combatant.js';
import { stableStat } from '../engine/rules/stats.js';
import type { Action, BattleState } from '../engine/model/battle.js';
import type { BondedCreature, TypeId } from '../engine/model/types.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, FLAT_STATS } from './helpers.js';

const data = loadData();
const tank = { ...FLAT_STATS, hp: 5000 };
const repertoire = [...data.manifestations.keys()];
const S = (id: string, est: 'iniciado' | 'invocador' = 'iniciado') => summoner(id, est, { amplitude: null, manifestationRepertoire: repertoire });
const at = (techniqueId: string, positionId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'position', positionId } });
const self = (techniqueId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'auto' } });
const c = (id: string, over: Partial<BondedCreature> = {}) => creature(id, over);
const z = (over: Partial<BondedCreature> = {}) => c('z', { speciesId: 'tamegona', types: ['tierra'], baseStatsNV50: tank, equippedTechniques: ['enfado', 'aranazo'], ...over });
const dmg = (st: BattleState, actor: string, fromRound = 0) => eventsOf(st, 'damage', fromRound).filter((e) => e.actor === actor);
const maxHpOf = (b: BondedCreature) => combatant(start(data, setup(S('a'), [b]), setup(S('b'), [z()])), uid(0, b.id)).maxHp;

test('Ultimo hilo: con Vitalidad completa sobrevive con 1 a un golpe letal; el siguiente lo derrota', () => {
  const a = c('a', { baseStatsNV50: { ...FLAT_STATS, atk: 3000 } });
  const t = c('t', { baseStatsNV50: { ...FLAT_STATS, hp: 20 }, equippedTechniques: ['enfado'], equippedManifestations: ['ultimo_hilo'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [t]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'survived')[0]!.data!.source, 'ultimo_hilo');
  assert.equal(combatant(st, uid(1, 't')).hp, 1);
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  assert.equal(combatant(st, uid(1, 't')).location, 'defeated');
});

test('Segundo aliento: la primera vez que cae por debajo del 50% recupera 25% una sola vez', () => {
  const base = c('t', { baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['segundo_aliento'] });
  const max = maxHpOf(base);
  const t = { ...base, hpCurrent: Math.floor(max / 2) + 10 };
  const a = c('a', { baseStatsNV50: { ...FLAT_STATS, atk: 800 } });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [t]));
  for (let i = 0; i < 6 && !st.outcome; i++) st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  const heals = eventsOf(st, 'heal').filter((e) => e.data!.source === 'segundo_aliento');
  assert.equal(heals.length, 1);
  assert.equal(heals[0]!.data!.healed, Math.round(max * 0.25));
});

test('Amartillar: +100% fisico y compromiso con la primera tecnica usada', () => {
  const a = c('a', { equippedTechniques: ['aranazo', 'enfado'], equippedManifestations: ['amartillar'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  const mods = dmg(st, uid(0, 'a'))[0]!.data!.modifiers as { source: string; pct: number }[];
  assert.ok(mods.some((m) => m.source === 'amartillar' && m.pct === 100));
  assert.throws(() => round(data, st, { S0P0: self('enfado'), S1P0: self('enfado') }), DeclarationError);
});

test('Sobrecarga: las tecnicas multigolpe realizan al menos 4 impactos', () => {
  const a = c('a', { equippedTechniques: ['rafaga_de_zarpazos'], equippedManifestations: ['sobrecarga'] });
  for (let seed = 1; seed <= 6; seed++) {
    const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()]), seed), { S0P0: at('rafaga_de_zarpazos', 'S1P0'), S1P0: self('enfado') });
    const hits = Number(eventsOf(st, 'hit_count')[0]!.data!.hits);
    assert.ok(hits >= 4 && hits <= 5);
    assert.equal(dmg(st, uid(0, 'a')).length, hits);
  }
});

test('Horda: tres golpes con el Ataque de cada cadaver escalado al NV y su tecnica anatomica', () => {
  const horde = [
    { speciesId: 'lobo', atkNV50: 150, techniqueId: 'aranazo' },
    { speciesId: 'oso', atkNV50: 200, techniqueId: 'aranazo' },
    { speciesId: 'jabali', atkNV50: 90, techniqueId: 'aranazo' },
  ];
  const h = c('h', { speciesId: 'holomicor', types: ['oscuridad', 'planta'] as TypeId[], nv: 40, equippedTechniques: ['horda'], horde });
  const st = round(data, start(data, setup(S('a'), [h]), setup(S('b'), [z()])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') });
  const corpses = eventsOf(st, 'horde_corpse');
  assert.deepEqual(corpses.map((e) => e.data!.attack), horde.map((x) => stableStat(x.atkNV50, 40)));
  const hits = dmg(st, uid(0, 'h'));
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((e) => e.data!.attack), horde.map((x) => stableStat(x.atkNV50, 40)));
  const bare = c('h', { speciesId: 'holomicor', types: ['oscuridad', 'planta'] as TypeId[], equippedTechniques: ['horda'] });
  assert.throws(() => round(data, start(data, setup(S('a'), [bare]), setup(S('b'), [z()])), { S0P0: at('horda', 'S1P0'), S1P0: self('enfado') }), DeclarationError);
});

test('Regeneracion: recupera 6,25% de la Vitalidad maxima al final de su turno', () => {
  const base = c('a', { equippedTechniques: ['enfado'], equippedManifestations: ['regeneracion'] });
  const max = maxHpOf(base);
  const st = round(data, start(data, setup(S('a'), [{ ...base, hpCurrent: 50 }]), setup(S('b'), [z()])), { S0P0: self('enfado'), S1P0: self('enfado') });
  const h = eventsOf(st, 'heal').find((e) => e.data!.source === 'regeneracion')!;
  assert.equal(h.data!.healed, Math.round(max * 0.0625));
});

test('Campo rocoso: 12,5% al entrar a las criaturas que no son Tierra; Defensa +50% a las de Tierra', () => {
  const r = z({ id: 'r', equippedManifestations: ['campo_rocoso'] });
  const b1 = c('b1', { baseStatsNV50: tank });
  const b2 = c('b2');
  let st = start(data, setup(S('a'), [r]), setup(S('b'), [b1, b2]));
  assert.equal(st.environment?.id, 'campo_rocoso');
  st = round(data, st, { S0P0: self('enfado'), S1P0: { kind: 'switch', incomingId: 'b2' } });
  const hit = eventsOf(st, 'environment_damage').find((e) => e.targets?.[0] === uid(1, 'b2'))!;
  assert.equal(hit.data!.loss, Math.round(combatant(st, uid(1, 'b2')).maxHp * 0.125));
  st = round(data, st, { S0P0: self('enfado'), S1P0: at('aranazo', 'S0P0') });
  const d = dmg(st, uid(1, 'b2'), 2)[0]!;
  const plain = effStat(data, combatant(st, uid(0, 'r')), 'def');
  assert.ok(Math.abs(Number(d.data!.defense) / plain - 1.5) < 0.01);
});

test('Tormenta electrica: pierden 6,25% por turno las criaturas que no son Rayo ni Tierra', () => {
  const r = c('r', { types: ['rayo'], baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['tormenta_electrica'] });
  const b = c('b', { baseStatsNV50: tank, equippedTechniques: ['enfado'] });
  const st = round(data, start(data, setup(S('a'), [r]), setup(S('b'), [b])), { S0P0: self('enfado'), S1P0: self('enfado') });
  const losses = eventsOf(st, 'environment_damage');
  assert.deepEqual(losses.map((e) => e.targets?.[0]), [uid(1, 'b')]);
  assert.equal(losses[0]!.data!.loss, Math.round(combatant(st, uid(1, 'b')).maxHp * 0.0625));
});

test('Presagio imposible: el siguiente ataque recibido por cada enemigo causa +75% y la marca desaparece', () => {
  const a = c('a', { types: ['mitico'], equippedManifestations: ['presagio_imposible'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  const [first, second] = dmg(st, uid(0, 'a')).map((e) => (e.data!.modifiers as { source: string }[]).map((m) => m.source));
  assert.ok(first!.includes('presagio_imposible'));
  assert.ok(!second!.includes('presagio_imposible'));
});

test('Retaguardia: tras una tecnica de Estado, el siguiente dano a un aliado se reduce 50% una vez', () => {
  const a = c('a', { equippedTechniques: ['enfado'], baseStatsNV50: tank, equippedManifestations: ['retaguardia'] });
  const b = c('b', { baseStatsNV50: { ...FLAT_STATS, spe: 50 } });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [b]));
  st = round(data, st, { S0P0: self('enfado'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: self('enfado'), S1P0: at('aranazo', 'S0P0') });
  const [r1, r2] = dmg(st, uid(1, 'b')).map((e) => e.data!.modifiers as { source: string; pct: number }[]);
  assert.ok(r1!.some((m) => m.source === 'retaguardia' && m.pct === -50));
  assert.ok(r2!.some((m) => m.source === 'retaguardia'));
  assert.equal(eventsOf(st, 'side_effect_destroyed').filter((e) => e.data!.consumed).length, 2);
});

test('Presencia opresiva baja 2 etapas de Ataque; Desafiante responde con +2', () => {
  const a = c('a', { equippedManifestations: ['presencia_opresiva'] });
  const b = z({ equippedManifestations: ['desafiante'] });
  const st = start(data, setup(S('a'), [a]), setup(S('b'), [b]));
  assert.equal(combatant(st, uid(1, 'z')).stages.atk, 0);
  const deltas = eventsOf(st, 'stage').filter((e) => e.targets?.[0] === uid(1, 'z')).map((e) => [e.data!.source, e.data!.delta]);
  assert.deepEqual(deltas, [['presencia_opresiva', -2], ['desafiante', 2]]);
});

test('No me toques: al bajar una caracteristica es sustituido por una criatura elegida al azar', () => {
  const a = c('a', { equippedManifestations: ['presencia_opresiva'] });
  const st = start(data, setup(S('a'), [a]), setup(S('b'), [z({ equippedManifestations: ['no_me_toques'] }), c('r1'), c('r2')]));
  const sw = eventsOf(st, 'self_switch');
  assert.equal(sw.length, 1);
  assert.equal(combatant(st, uid(1, 'z')).location, 'intermedio');
  assert.ok([uid(1, 'r1'), uid(1, 'r2')].includes(st.sides[1].positions[0]!.occupantUid!));
});

test('Espejo concavo invierte las subidas recibidas', () => {
  const a = c('a', { equippedTechniques: ['enfado'], equippedManifestations: ['espejo_concavo'] });
  const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()])), { S0P0: self('enfado'), S1P0: self('enfado') });
  assert.equal(combatant(st, uid(0, 'a')).stages.atk, -1);
  assert.equal(eventsOf(st, 'stage_inverted').length, 1);
});

test('Raiz compartida: el portador recibe parte del dano dirigido a su aliado', () => {
  const r = c('r', { types: ['planta'], baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['raiz_compartida'] });
  const x = c('x', { baseStatsNV50: tank, equippedTechniques: ['enfado'] });
  const st = round(data, start(data, setup(S('a'), [c('a')]), setup(S('b', 'invocador'), [r, x], ['r', 'x'])), { S0P0: at('aranazo', 'S1P1'), S1P0: self('enfado'), S1P1: self('enfado') });
  const d = dmg(st, uid(0, 'a'))[0]!;
  assert.equal(d.data!.sharedWith, uid(1, 'r'));
  const shared = eventsOf(st, 'shared_damage')[0]!;
  assert.equal(shared.targets?.[0], uid(1, 'r'));
  assert.equal(shared.data!.loss, Math.round(Number(d.data!.raw) * 2 / 4));
});

test('Ruptura de afinidad ignora resistencias; Negacion elemental impide el superefectivo', () => {
  const chart = data.types.effectiveness.fuego;
  const resist = (Object.keys(chart) as TypeId[]).find((k) => chart[k] === 0.5)!;
  const weak = (Object.keys(chart) as TypeId[]).find((k) => chart[k] === 2)!;
  const a = c('a', { types: ['mitico', 'fuego'], equippedTechniques: ['llama'], equippedManifestations: ['ruptura_de_afinidad'] });
  let st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z({ types: [resist] })])), { S0P0: at('llama', 'S1P0'), S1P0: self('enfado') });
  assert.equal(dmg(st, uid(0, 'a'))[0]!.data!.typeMult, 1);
  const f = c('f', { types: ['fuego'], equippedTechniques: ['llama'] });
  st = round(data, start(data, setup(S('a'), [f]), setup(S('b'), [z({ types: ['mitico', weak], equippedManifestations: ['negacion_elemental'] })])), { S0P0: at('llama', 'S1P0'), S1P0: self('enfado') });
  assert.equal(dmg(st, uid(0, 'f'))[0]!.data!.typeMult, 1);
});

test('10.10 / 16.5: Rebufo -> Entrada -> Respuesta -> Intercambio forzado -> Entrada: todo se resuelve antes de la siguiente accion y en profundidad', () => {
  const n = c('n', { speciesId: 'nimburu', types: ['aire'], baseStatsNV50: { ...tank, spe: 200 }, equippedTechniques: ['rebufo'] });
  const r = c('r', { types: ['tierra'], nv: 100, baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['presencia_opresiva', 'presion_arcana'] });
  const q = c('q', { baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['marca_ardiente'] });
  let st = start(data, setup(S('a'), [n, r]), setup(S('b'), [z({ equippedManifestations: ['no_me_toques'] }), q]));
  st = resolveRound(data, beginRound(data, st), { S0P0: at('rebufo', 'S1P0'), S1P0: at('aranazo', 'S0P0') }, { chooseOptionalSwitch: (_s, _u, cands) => cands[0]! });
  const log = st.log.filter((e) => e.round === 1);
  const idx = (pred: (e: (typeof log)[number]) => boolean) => log.findIndex(pred);
  const rebufoEnd = idx((e) => e.type === 'technique_end' && e.data!.technique === 'rebufo');
  const rIn = idx((e) => e.type === 'self_switch' && e.actor === uid(0, 'n'));
  const presencia = idx((e) => e.type === 'stage' && e.data!.source === 'presencia_opresiva' && e.targets?.[0] === uid(1, 'z'));
  const zOut = idx((e) => e.type === 'self_switch' && e.actor === uid(1, 'z'));
  const burn = idx((e) => e.data?.source === 'marca_ardiente' && e.targets?.[0] === uid(0, 'r'));
  const arcana = idx((e) => e.type === 'stage' && e.data!.source === 'presion_arcana');
  const zFails = idx((e) => e.type === 'action_failed' && e.actor === uid(1, 'z'));
  assert.ok(rebufoEnd < rIn && rIn < presencia && presencia < zOut && zOut < burn && burn < arcana && arcana < zFails, JSON.stringify([rebufoEnd, rIn, presencia, zOut, burn, arcana, zFails]));
  assert.equal(log[arcana]!.targets?.[0], uid(1, 'q'), 'Presion arcana alcanza al enemigo que ya ha entrado');
  assert.equal(dmg(st, uid(1, 'z')).length, 0);
  assert.equal(combatant(st, uid(1, 'q')).stages.matk, -2);
});

test('16.6 / 28.5: un Reemplazo forzado resuelve toda su cadena de Entrada antes de la siguiente accion', () => {
  const a = c('a', { baseStatsNV50: { ...FLAT_STATS, atk: 3000, spe: 200 } });
  const weak = c('w', { baseStatsNV50: { ...FLAT_STATS, hp: 10 }, equippedTechniques: ['enfado'] });
  const p = c('p', { baseStatsNV50: tank, equippedTechniques: ['enfado'], equippedManifestations: ['presencia_opresiva'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [weak, p]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  const log = st.log.filter((e) => e.round === 1);
  const repl = log.findIndex((e) => e.type === 'forced_replacement');
  const drop = log.findIndex((e) => e.type === 'stage' && e.data!.source === 'presencia_opresiva');
  const end = log.findIndex((e) => e.type === 'end_of_round');
  assert.ok(repl >= 0 && repl < drop && drop < end);
  assert.equal(combatant(st, uid(0, 'a')).stages.atk, -2);
});

test('18.2 / 28.5: si una accion altera la Velocidad se recalcula el orden de las pendientes (Estela)', () => {
  const a1 = c('a1', { speciesId: 'tamegona', types: ['tierra'], baseStatsNV50: { ...tank, spe: 200 }, equippedTechniques: ['estela', 'aranazo'] });
  const a2 = c('a2', { baseStatsNV50: { ...tank, spe: 50 } });
  const b = c('b', { baseStatsNV50: { ...tank, spe: 80 } });
  const st = round(data, start(data, setup(S('a', 'invocador'), [a1, a2], ['a1', 'a2']), setup(S('b'), [b])), {
    S0P0: self('estela'), S0P1: at('aranazo', 'S1P0'), S1P0: at('aranazo', 'S0P0'),
  });
  const orders = eventsOf(st, 'action_order').map((e) => e.data!.order);
  assert.deepEqual(orders, [[uid(0, 'a1'), uid(1, 'b'), uid(0, 'a2')], [uid(0, 'a2'), uid(1, 'b')]]);
  const hits = eventsOf(st, 'damage').map((e) => e.actor);
  assert.deepEqual(hits, [uid(0, 'a2'), uid(1, 'b')]);
});
