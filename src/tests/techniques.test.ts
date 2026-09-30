import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginRound, DeclarationError, resolveRound } from '../engine/pipeline/battle.js';
import { combatant } from '../engine/pipeline/context.js';
import { DEFAULT_CONFIG, type Action, type BattleState, type Declarations } from '../engine/model/battle.js';
import type { BondedCreature, TypeId } from '../engine/model/types.js';
import type { Controllers } from '../engine/pipeline/context.js';
import { creature, eventsOf, loadData, round, setup, start, summoner, uid, FLAT_STATS } from './helpers.js';
import { legalMap } from '../app/simulate.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import { createRng } from '../engine/rng.js';

const data = loadData();
const tank = { ...FLAT_STATS, hp: 5000 };
const repertoire = [...data.manifestations.keys()];
const S = (id: string, est: 'iniciado' | 'invocador' = 'iniciado') => summoner(id, est, { amplitude: null, manifestationRepertoire: repertoire });
const at = (techniqueId: string, positionId: string, choice?: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'position', positionId }, ...(choice ? { choice } : {}) });
const self = (techniqueId: string): Action => ({ kind: 'technique', techniqueId, target: { kind: 'auto' } });
const c = (id: string, over: Partial<BondedCreature> = {}) => creature(id, over);
const z = (over: Partial<BondedCreature> = {}) => c('z', { speciesId: 'tamegona', types: ['tierra'], baseStatsNV50: tank, equippedTechniques: ['enfado', 'aranazo'], ...over });
const dmg = (st: BattleState, actor: string, fromRound = 0) => eventsOf(st, 'damage', fromRound).filter((e) => e.actor === actor);
const withCtl = (st: BattleState, decls: Declarations, ctl: Controllers) => resolveRound(data, beginRound(data, st), decls, ctl);

test('21.2 / 24.7: etapas, limite +6 y Paralizado impide subir Velocidad (Enfado, Acelerar, Pacto de sangre)', () => {
  const a = c('a', { equippedTechniques: ['enfado', 'acelerar', 'pacto_de_sangre'], persistentStatuses: [{ id: 'paralizado', counters: { stat_cannot_increase: 5 } }] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: self('enfado'), S1P0: self('enfado') });
  st = round(data, st, { S0P0: self('acelerar'), S1P0: self('enfado') });
  st = round(data, st, { S0P0: self('pacto_de_sangre'), S1P0: self('enfado') });
  const x = combatant(st, uid(0, 'a'));
  assert.deepEqual([x.stages.atk, x.stages.spe, x.stages.matk], [1, 0, 6]);
  assert.equal(x.hp, 150);
  assert.equal(eventsOf(st, 'stage_blocked').length, 1);
});

test('24.10: Desvinculado reduce 25% la curacion (Agua curativa)', () => {
  const a = c('a', { hpCurrent: 100, equippedTechniques: ['agua_curativa'], persistentStatuses: [{ id: 'desvinculado', counters: { manifestations_disabled: 5, bond_communication_cut: 5 } }] });
  const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()])), { S0P0: self('agua_curativa'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'heal')[0]!.data!.healed, Math.round(99 * 0.75));
});

test('19.6: retroceso y drenaje usan la Vitalidad realmente perdida (Envite ardiente, Drenar)', () => {
  const a = c('a', { hpCurrent: 100, equippedTechniques: ['envite_ardiente', 'drenar'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: at('envite_ardiente', 'S1P0'), S1P0: self('enfado') });
  const l1 = Number(dmg(st, uid(0, 'a'))[0]!.data!.loss);
  assert.equal(eventsOf(st, 'recoil')[0]!.data!.loss, Math.round(l1 * 0.1));
  st = round(data, st, { S0P0: at('drenar', 'S1P0'), S1P0: self('enfado') });
  const l2 = Number(dmg(st, uid(0, 'a'), 2)[0]!.data!.loss);
  assert.equal(eventsOf(st, 'heal', 2)[0]!.data!.healed, Math.round(l2 * 0.5));
});

test('25.3 / 23.3: Barrera de fuerza divide el dano fisico; Martillo magmatico la destruye antes del calculo', () => {
  const a = c('a', { equippedTechniques: ['aranazo', 'martillo_magmatico'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z({ equippedTechniques: ['barrera_de_fuerza', 'enfado'] })]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('barrera_de_fuerza') });
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  assert.equal(dmg(st, uid(0, 'a'), 2)[0]!.data!.halvings, 1);
  assert.equal(dmg(st, uid(0, 'a'), 2)[0]!.data!.loss, Math.round((DEFAULT_CONFIG.damageConstant * 0.45 * 100) / 2));
  st = round(data, st, { S0P0: at('martillo_magmatico', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'side_effect_destroyed', 3)[0]!.data!.id, 'barrera_de_fuerza');
  assert.equal(dmg(st, uid(0, 'a'), 3)[0]!.data!.halvings, 0);
});

test('Estela duplica la Velocidad aliada; Marana la destruye', () => {
  const a = c('a', { equippedTechniques: ['aranazo', 'marana'] });
  const slow = z({ baseStatsNV50: { ...tank, spe: 80 }, equippedTechniques: ['estela', 'aranazo'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [slow]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('estela') });
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.deepEqual(eventsOf(st, 'action_order', 2)[0]!.data!.order, [uid(1, 'z'), uid(0, 'a')]);
  st = round(data, st, { S0P0: at('marana', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(eventsOf(st, 'side_effect_destroyed', 3)[0]!.data!.id, 'estela');
});

test('16.5: sustitucion tras causar dano ignora Enraizado; la opcional depende del invocador', () => {
  const l = c('l', { equippedTechniques: ['liana_de_retorno'], persistentStatuses: [{ id: 'enraizado', counters: { no_voluntary_withdraw: 2 } }] });
  const st = round(data, start(data, setup(S('a'), [l, c('r')]), setup(S('b'), [z()])), { S0P0: at('liana_de_retorno', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'self_switch').length, 1);
  assert.equal(st.sides[0].positions[0]!.occupantUid, uid(0, 'r'));

  const n = c('n', { speciesId: 'nimburu', types: ['aire'], equippedTechniques: ['rebufo'] });
  const base = start(data, setup(S('a'), [n, c('r')]), setup(S('b'), [z()]));
  const decls = { S0P0: at('rebufo', 'S1P0'), S1P0: self('enfado') };
  const declined = withCtl(base, decls, {});
  assert.equal(eventsOf(declined, 'self_switch_declined').length, 1);
  const taken = withCtl(base, decls, { chooseOptionalSwitch: (_s, _u, cands) => cands[0]! });
  assert.equal(taken.sides[0].positions[0]!.occupantUid, uid(0, 'r'));
});

test('No puede usarse dos turnos consecutivos (Prensa tectonica)', () => {
  const a = c('a', { equippedTechniques: ['prensa_tectonica', 'aranazo'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: at('prensa_tectonica', 'S1P0'), S1P0: self('enfado') });
  assert.throws(() => round(data, st, { S0P0: at('prensa_tectonica', 'S1P0'), S1P0: self('enfado') }), DeclarationError);
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  round(data, st, { S0P0: at('prensa_tectonica', 'S1P0'), S1P0: self('enfado') });
});

test('Mordisco de presa: el objetivo no puede ser sustituido en su siguiente turno', () => {
  const a = c('a', { equippedTechniques: ['mordisco_de_presa'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z(), c('q')]));
  st = round(data, st, { S0P0: at('mordisco_de_presa', 'S1P0'), S1P0: self('enfado') });
  assert.throws(() => round(data, st, { S0P0: at('mordisco_de_presa', 'S1P0'), S1P0: { kind: 'switch', incomingId: 'q' } }), DeclarationError);
  st = round(data, st, { S0P0: at('mordisco_de_presa', 'S1P0'), S1P0: self('enfado') });
  assert.doesNotThrow(() => round(data, st, { S0P0: at('mordisco_de_presa', 'S1P0'), S1P0: self('enfado') }));
});

test('Canto final: las marcadas que siguen en campo al final de la tercera ronda son derrotadas', () => {
  const f = c('f', { speciesId: 'fenyrax', types: ['fuego', 'aire'], baseStatsNV50: tank, equippedTechniques: ['canto_final', 'enfado'] });
  let st = start(data, setup(S('a'), [f, c('f2')]), setup(S('b'), [z(), c('z2')]));
  st = round(data, st, { S0P0: self('canto_final'), S1P0: self('enfado') });
  st = round(data, st, { S0P0: self('enfado'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'death_mark').length, 0);
  st = round(data, st, { S0P0: self('enfado'), S1P0: self('enfado') });
  assert.deepEqual(eventsOf(st, 'death_mark').map((e) => e.round), [3, 3]);
  assert.equal(combatant(st, uid(0, 'f')).location, 'defeated');
  assert.equal(combatant(st, uid(1, 'z')).location, 'defeated');
  assert.equal(st.sides[0].positions[0]!.occupantUid, uid(0, 'f2'));
});

test('Bajo mi amparo redirige los ataques de objetivo unico y reduce 25% ese dano', () => {
  const arch = c('arch', { speciesId: 'archelia', types: ['luz'], baseStatsNV50: tank, equippedTechniques: ['bajo_mi_amparo'] });
  const st = round(data, start(data, setup(S('a'), [c('a')]), setup(S('b', 'invocador'), [arch, c('x', { baseStatsNV50: tank, equippedTechniques: ['enfado'] })], ['arch', 'x'])), {
    S0P0: at('aranazo', 'S1P1'), S1P0: self('bajo_mi_amparo'), S1P1: self('enfado'),
  });
  const d = dmg(st, uid(0, 'a'))[0]!;
  assert.deepEqual(d.targets, [uid(1, 'arch')]);
  assert.ok((d.data!.modifiers as { source: string }[]).some((m) => m.source === 'redireccion'));
});

test('Caza espectral intercepta a la criatura saliente con +100% y el cambio continua', () => {
  const u = c('u', { speciesId: 'umbrafen', types: ['oscuridad', 'mitico'], equippedTechniques: ['caza_espectral'] });
  const st = round(data, start(data, setup(S('a'), [u]), setup(S('b'), [z(), c('q')])), { S0P0: at('caza_espectral', 'S1P0'), S1P0: { kind: 'switch', incomingId: 'q' } });
  const d = dmg(st, uid(0, 'u'));
  assert.equal(d.length, 1);
  assert.deepEqual(d[0]!.targets, [uid(1, 'z')]);
  assert.ok((d[0]!.data!.modifiers as { pct: number }[]).some((m) => m.pct === 100));
  assert.ok(eventsOf(st, 'switch')[0]!.id > d[0]!.id);
  assert.equal(st.sides[1].positions[0]!.occupantUid, uid(1, 'q'));
});

test('Velocidad invertida: dentro de la misma Prioridad actua antes la mas lenta', () => {
  const slow = c('s', { baseStatsNV50: { ...tank, spe: 50 }, equippedTechniques: ['velocidad_invertida', 'aranazo'] });
  const fast = c('f', { baseStatsNV50: { ...tank, spe: 150 } });
  let st = start(data, setup(S('a'), [slow]), setup(S('b'), [fast]));
  st = round(data, st, { S0P0: self('velocidad_invertida'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.deepEqual(eventsOf(st, 'action_order', 2)[0]!.data!.order, [uid(0, 's'), uid(1, 'f')]);
});

test('Anular prioridad reordena las acciones pendientes de la ronda', () => {
  const an = c('an', { baseStatsNV50: tank, equippedTechniques: ['anular_prioridad'] });
  const b = c('b', { baseStatsNV50: { ...tank, spe: 200 } });
  const r = c('r', { speciesId: 'vajrakar', types: ['rayo'], baseStatsNV50: { ...tank, spe: 50 }, equippedTechniques: ['relampago'] });
  const st = round(data, start(data, setup(S('a', 'invocador'), [an, b], ['an', 'b']), setup(S('b'), [r])), {
    S0P0: self('anular_prioridad'), S0P1: at('aranazo', 'S1P0'), S1P0: at('relampago', 'S0P0'),
  });
  const orders = eventsOf(st, 'action_order');
  assert.deepEqual(orders[0]!.data!.order, [uid(0, 'an'), uid(1, 'r'), uid(0, 'b')]);
  assert.deepEqual(orders[1]!.data!.order, [uid(0, 'b'), uid(1, 'r')]);
});

test('Bola de fuego: la segunda criatura activa recibe el 50% del dano final', () => {
  const a = c('a', { equippedTechniques: ['bola_de_fuego'] });
  const st = round(data, start(data, setup(S('a'), [a]), setup(S('b', 'invocador'), [z(), c('q', { speciesId: 'tamegona', types: ['tierra'], baseStatsNV50: tank, equippedTechniques: ['enfado'] })], ['z', 'q'])), {
    S0P0: at('bola_de_fuego', 'S1P0'), S1P0: self('enfado'), S1P1: self('enfado'),
  });
  const primary = Number(dmg(st, uid(0, 'a'))[0]!.data!.calculated);
  assert.equal(eventsOf(st, 'splash_damage')[0]!.data!.loss, Math.round(primary / 2));
  assert.deepEqual(eventsOf(st, 'splash_damage')[0]!.targets, [uid(1, 'q')]);
});

test('Aprovechar hueco: doble dano si el objetivo declaro una tecnica de Estado', () => {
  const s = c('s', { speciesId: 'sargot', types: ['oscuridad'], equippedTechniques: ['aprovechar_hueco'] });
  const st = round(data, start(data, setup(S('a'), [s]), setup(S('b'), [z()])), { S0P0: at('aprovechar_hueco', 'S1P0'), S1P0: self('enfado') });
  assert.ok((dmg(st, uid(0, 's'))[0]!.data!.modifiers as { pct: number; source: string }[]).some((m) => m.source === 'aprovechar_hueco' && m.pct === 100));
});

test('Pulso intermitente alterna Prioridad +1 y +50% de dano', () => {
  const p = c('p', { speciesId: 'zulpin', types: ['rayo'], baseStatsNV50: { ...tank, spe: 50 }, equippedTechniques: ['pulso_intermitente'] });
  const f = z({ baseStatsNV50: { ...tank, spe: 150 } });
  let st = start(data, setup(S('a'), [p]), setup(S('b'), [f]));
  st = round(data, st, { S0P0: at('pulso_intermitente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  st = round(data, st, { S0P0: at('pulso_intermitente', 'S1P0'), S1P0: at('aranazo', 'S0P0') });
  assert.deepEqual(eventsOf(st, 'action_order').map((e) => (e.data!.order as string[])[0]), [uid(0, 'p'), uid(1, 'z')]);
  assert.deepEqual(dmg(st, uid(0, 'p')).map((e) => (e.data!.modifiers as { pct: number }[]).map((m) => m.pct)), [[], [50]]);
});

test('Incinerar: +25% por uso consecutivo contra el mismo objetivo', () => {
  const a = c('a', { equippedTechniques: ['incinerar'] });
  let st = start(data, setup(S('a'), [a]), setup(S('b'), [z()]));
  for (let i = 0; i < 3; i++) st = round(data, st, { S0P0: at('incinerar', 'S1P0'), S1P0: self('enfado') });
  assert.deepEqual(dmg(st, uid(0, 'a')).map((e) => (e.data!.modifiers as { pct: number }[]).map((m) => m.pct)), [[], [25], [50]]);
});

test('Sesteo: la bajada de Defensa solo dura hasta terminar la ronda', () => {
  const a = c('a', { speciesId: 'camalin', types: ['planta'], hpCurrent: 100, equippedTechniques: ['sesteo'] });
  const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()])), { S0P0: self('sesteo'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'heal')[0]!.data!.healed, 99);
  assert.ok(eventsOf(st, 'stage').some((e) => e.data!.stat === 'def' && e.data!.to === -1));
  assert.equal(combatant(st, uid(0, 'a')).stages.def, 0);
});

test('Cristal opaco absorbe el siguiente dano magico y Prisma de retorno consume la energia (+50%)', () => {
  const l = c('l', { speciesId: 'luminax', priorForms: ['zercual'], types: ['luz'], baseStatsNV50: { ...tank, spe: 200 }, equippedTechniques: ['cristal_opaco', 'prisma_de_retorno'] });
  const f = z({ equippedTechniques: ['llama'] });
  let st = start(data, setup(S('a'), [l]), setup(S('b'), [f]));
  st = round(data, st, { S0P0: self('cristal_opaco'), S1P0: at('llama', 'S0P0') });
  assert.ok((dmg(st, uid(1, 'z'))[0]!.data!.modifiers as { source: string }[]).some((m) => m.source === 'cristal_opaco'));
  st = round(data, st, { S0P0: at('prisma_de_retorno', 'S1P0'), S1P0: at('llama', 'S0P0') });
  assert.ok((dmg(st, uid(0, 'l'), 2)[0]!.data!.modifiers as { pct: number }[]).some((m) => m.pct === 50));
  assert.equal(combatant(st, uid(0, 'l')).marks.filter((m) => m.kind === 'stored_energy').length, 0);
});

test('Caparazon incandescente castiga las tecnicas de contacto (GAP-CONTACT: fisicas)', () => {
  const b = c('b', { speciesId: 'brascajo', types: ['fuego'], baseStatsNV50: { ...tank, spe: 200 }, equippedTechniques: ['caparazon_incandescente'] });
  const st = round(data, start(data, setup(S('a'), [b]), setup(S('b'), [c('x', { baseStatsNV50: { ...FLAT_STATS, hp: 320 } })])), { S0P0: self('caparazon_incandescente'), S1P0: at('aranazo', 'S0P0') });
  assert.equal(eventsOf(st, 'retaliation_damage')[0]!.data!.loss, Math.round(320 * 0.125));
});

test('Mueca exige elegir una opcion y aplica la elegida', () => {
  const m = c('m', { speciesId: 'calanima', types: ['oscuridad'], equippedTechniques: ['mueca'] });
  const st = start(data, setup(S('a'), [m]), setup(S('b'), [z()]));
  assert.throws(() => round(data, st, { S0P0: at('mueca', 'S1P0'), S1P0: self('enfado') }), DeclarationError);
  const r = round(data, st, { S0P0: at('mueca', 'S1P0', 'atk'), S1P0: self('enfado') });
  assert.equal(combatant(r, uid(1, 'z')).stages.atk, 0);
  assert.ok(eventsOf(r, 'stage').some((e) => e.targets![0] === uid(1, 'z') && e.data!.delta === -1));
});

test('Helar: supereficaz contra Planta aunque la tabla diga x0,5 (GAP-FORCED-SE)', () => {
  const a = c('a', { equippedTechniques: ['helar'] });
  const p = c('p', { speciesId: 'mairahda', types: ['planta'], baseStatsNV50: tank, equippedTechniques: ['enfado'] });
  const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [p])), { S0P0: at('helar', 'S1P0'), S1P0: self('enfado') });
  assert.equal(dmg(st, uid(0, 'a'))[0]!.data!.typeMult, 2);
});

test('Aliento de dragon ataca en el primer turno con Calima activa', () => {
  const d = c('d', { equippedTechniques: ['aliento_de_dragon'], equippedManifestations: ['calima'] });
  const st = round(data, start(data, setup(S('a'), [d]), setup(S('b'), [z()])), { S0P0: at('aliento_de_dragon', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'charge_start').length, 0);
  assert.equal(dmg(st, uid(0, 'd')).length, 1);
});

test('Retorno arcano impide usar tecnicas Miticas en el siguiente turno', () => {
  const m = c('m', { types: ['mitico'], speciesId: 'lernyra', equippedTechniques: ['retorno_arcano', 'proyectil_arcano', 'aranazo'] });
  let st = start(data, setup(S('a'), [m]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: at('retorno_arcano', 'S1P0'), S1P0: self('enfado') });
  assert.throws(() => round(data, st, { S0P0: at('proyectil_arcano', 'S1P0'), S1P0: self('enfado') }), DeclarationError);
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  assert.doesNotThrow(() => round(data, st, { S0P0: at('proyectil_arcano', 'S1P0'), S1P0: self('enfado') }));
});

test('Infeccion: perdida al final de cada ronda y sin retirada voluntaria durante 2 rondas', () => {
  const m = c('m', { speciesId: 'micora', types: ['planta'], equippedTechniques: ['infeccion', 'aranazo'] });
  let st = start(data, setup(S('a'), [m]), setup(S('b'), [z({ baseStatsNV50: { ...FLAT_STATS, hp: 320 } }), c('q')]));
  st = round(data, st, { S0P0: at('infeccion', 'S1P0'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'periodic_damage')[0]!.data!.loss, Math.round(320 * 0.0625));
  assert.throws(() => round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: { kind: 'switch', incomingId: 'q' } }), DeclarationError);
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
  const r = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: { kind: 'switch', incomingId: 'q' } });
  assert.equal(r.sides[1].positions[0]!.occupantUid, uid(1, 'q'));
});

test('Revelacion absoluta elimina subidas y evasion enemigas e impide nuevas evasiones', () => {
  const p = c('p', { speciesId: 'photerion', types: ['luz'], baseStatsNV50: tank, equippedTechniques: ['revelacion_absoluta'] });
  const v = z({ equippedTechniques: ['enfado', 'borrar_el_contorno'], speciesId: 'velin', types: ['oscuridad'] });
  let st = start(data, setup(S('a'), [p]), setup(S('b'), [v]));
  const dodge: Action = { kind: 'dodge' };
  st = round(data, st, { S0P0: dodge, S1P0: self('enfado') });
  st = round(data, st, { S0P0: dodge, S1P0: self('borrar_el_contorno') });
  st = round(data, st, { S0P0: self('revelacion_absoluta'), S1P0: self('enfado') });
  const x = combatant(st, uid(1, 'z'));
  assert.equal(x.marks.filter((m) => m.evasion).length, 0);
  st = round(data, st, { S0P0: dodge, S1P0: self('borrar_el_contorno') });
  assert.equal(eventsOf(st, 'mark_blocked').length, 1);
});

test('Borrar el contorno: -50% al proximo ataque recibido, y se consume aunque ese ataque falle', () => {
  const v = z({ equippedTechniques: ['enfado', 'borrar_el_contorno'], speciesId: 'velin', types: ['oscuridad'], baseStatsNV50: { ...tank, spe: 200 } });
  let st = start(data, setup(S('a'), [c('a')]), setup(S('b'), [v]));
  st = round(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('borrar_el_contorno') });
  const r1 = st.log.filter((e) => e.round === 1 && e.actor === uid(0, 'a') && (e.type === 'damage' || e.type === 'miss'))[0]!;
  assert.equal(r1.rolls?.[0]?.threshold, 50);
  assert.equal(combatant(st, uid(1, 'z')).marks.length, 0);
});

test('Mediodia: carga, baja mucho el Ataque magico y queda bloqueada hasta volver a entrar', () => {
  const p = c('p', { speciesId: 'photerion', types: ['luz'], baseStatsNV50: tank, equippedTechniques: ['mediodia'] });
  let st = start(data, setup(S('a'), [p]), setup(S('b'), [z()]));
  st = round(data, st, { S0P0: self('mediodia'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'charge_start').length, 1);
  st = round(data, st, { S0P0: self('mediodia'), S1P0: self('enfado') });
  assert.equal(dmg(st, uid(0, 'p')).length, 1);
  assert.equal(combatant(st, uid(0, 'p')).stages.matk, -2);
  assert.throws(() => round(data, st, { S0P0: self('mediodia'), S1P0: self('enfado') }), DeclarationError);
});

test('Colapso destruye las barreras enemigas antes del dano e impide retirarse esa ronda', () => {
  const k = c('k', { speciesId: 'skoterion', types: ['oscuridad'], equippedTechniques: ['colapso'] });
  const t = c('t', { speciesId: 'talifano', types: ['luz'], baseStatsNV50: tank, equippedTechniques: ['boveda_cristalina', 'enfado'] });
  let st = start(data, setup(S('a'), [k, c('k2')]), setup(S('b'), [t]));
  st = round(data, st, { S0P0: { kind: 'dodge' }, S1P0: self('boveda_cristalina') });
  assert.equal(eventsOf(st, 'side_effect_added').length, 1);
  st = round(data, st, { S0P0: self('colapso'), S1P0: self('enfado') });
  assert.equal(eventsOf(st, 'side_effect_destroyed', 2)[0]!.data!.id, 'boveda_cristalina');
  assert.ok(eventsOf(st, 'mark', 2).some((e) => e.data!.kind === 'no_withdraw'));
});

test('Puno preciso fuera del primer turno se marca como futil y la IA aleatoria no lo elige', () => {
  const a = c('a', { equippedTechniques: ['puno_preciso', 'aranazo'] });
  let st = beginRound(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()])));
  const opt = (s: BattleState) => legalMap(data, s, 0).get('S0P0')!.find((o) => o.action.kind === 'technique' && o.action.techniqueId === 'puno_preciso')!;
  assert.equal(opt(st).futile, undefined);
  st = beginRound(data, resolveRound(data, st, { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') }));
  assert.ok(opt(st).legal && opt(st).futile);
  for (let seed = 1; seed <= 50; seed++) {
    const d = randomLegalPolicy.declare(st, 0, legalMap(data, st, 0), createRng(seed));
    assert.notEqual((d.S0P0 as { techniqueId?: string }).techniqueId, 'puno_preciso');
  }
});

test('23.1: la constante de dano del canon es 0,9375 (+25% sobre la anterior 0,75) y es configurable', () => {
  const hit = (config = {}) => {
    const st = round(data, start(data, setup(S('a'), [c('a')]), setup(S('b'), [z()]), 1, config), { S0P0: at('aranazo', 'S1P0'), S1P0: self('enfado') });
    return Number(eventsOf(st, 'damage')[0]!.data!.raw);
  };
  assert.ok(Math.abs(hit() / hit({ damageConstant: 0.75 }) - 1.25) < 1e-9);
});

test('STAB: +25% de dano con tecnicas de un tipo propio (tambien en duotipos), sin aparecer en los modificadores', () => {
  const raw = (types: TypeId[], techniqueId: string) => {
    const a = c('a', { types, equippedTechniques: [techniqueId] });
    const st = round(data, start(data, setup(S('a'), [a]), setup(S('b'), [z()])), { S0P0: at(techniqueId, 'S1P0'), S1P0: self('enfado') });
    const d = eventsOf(st, 'damage')[0]!.data!;
    assert.deepEqual(d.modifiers, []);
    return Number(d.raw);
  };
  assert.ok(Math.abs(raw(['fuego'], 'llama') / raw(['tierra'], 'llama') - 1.25) < 1e-9);
  assert.ok(Math.abs(raw(['tierra', 'fuego'], 'llama') / raw(['tierra'], 'llama') - 1.25) < 1e-9);
  assert.equal(raw(['fuego'], 'aranazo'), raw(['tierra'], 'aranazo'));
});
