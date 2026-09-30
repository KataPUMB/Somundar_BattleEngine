import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePreparation } from '../engine/legality/preparation.js';
import { createBattle } from '../engine/pipeline/battle.js';
import { creatureName } from '../app/format.js';
import type { BondedCreatureInput, SideSetupInput } from '../engine/model/types.js';
import { creature, loadData, setup, summoner } from './helpers.js';

const data = loadData();
const codes = (v: ReturnType<typeof validatePreparation>) => v.filter((x) => x.severity === 'error').map((x) => x.code).sort();

test('nickname sustituye al nombre de la especie; sin nickname se usa la especie; vacio es error', () => {
  const st = createBattle(data, [
    setup(summoner('ana'), [creature('a', { speciesId: 'brasal', nickname: 'Chispa' })]),
    setup(summoner('bea'), [creature('b', { speciesId: 'brasal' })]),
  ], { seed: 1 });
  assert.equal(creatureName(st, '0:a'), 'Chispa (ana)');
  assert.equal(creatureName(st, '1:b'), `${data.species.get('brasal')!.name} (bea)`);
  assert.deepEqual(codes(validatePreparation(setup(summoner('ana'), [creature('a', { nickname: '  ' })]), data)), ['CRE_NICKNAME']);
});

test('Preparacion valida sin errores', () => {
  const s = summoner('ana', 'invocador', { manifestationRepertoire: ['combustion', 'juramento_de_las_mareas'] });
  const a = creature('a', { speciesId: 'brasal', equippedTechniques: ['golpe_candente', 'aranazo'], equippedManifestations: ['combustion'], fortaleza: { atk: 20, spe: 20 }, orientations: ['atk', 'spe'] });
  const b = creature('b', { speciesId: 'prueba', types: ['agua'], equippedManifestations: ['juramento_de_las_mareas'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [a, b], ['a', 'b']), data)), []);
});

test('7.1: 5 criaturas preparadas', () => {
  const s = summoner('ana');
  const cs = ['a', 'b', 'c', 'd', 'e'].map((id) => creature(id));
  assert.ok(codes(validatePreparation(setup(s, cs), data)).includes('PREP_MAX_4'));
});

test('8.2: 50 + 50 + 50 + 0 = 150 excede el coste local', () => {
  const s = summoner('ana', 'arconte');
  const a = creature('a', { equippedTechniques: ['envite_ardiente', 'conflagracion', 'impulso_hidraulico', 'aranazo'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [a]), data)), ['TECH_LOCAL_COST']);
});

test('8.1: mas de 4 tecnicas', () => {
  const a = creature('a', { equippedTechniques: ['aranazo', 'mordisco', 'patada', 'coletazo', 'zarpazo'] });
  assert.ok(codes(validatePreparation(setup(summoner('ana'), [a]), data)).includes('TECH_MAX_4'));
});

test('8.5 / 8.6: Amplitud excedida; Arconte sin restriccion global', () => {
  const techs = ['envite_ardiente', 'conflagracion'];
  const cs = ['a', 'b', 'c'].map((id) => creature(id, { equippedTechniques: techs }));
  assert.ok(codes(validatePreparation(setup(summoner('ana', 'invocador'), cs), data)).includes('AMPLITUDE'));
  const four = ['a', 'b', 'c', 'd'].map((id) => creature(id, { equippedTechniques: techs }));
  assert.deepEqual(codes(validatePreparation(setup(summoner('ana', 'arconte'), four), data)), []);
});

test('10.4: Manifestacion duplicada en la Preparacion', () => {
  const s = summoner('ana', 'invocador', { manifestationRepertoire: ['combustion'] });
  const cs = ['a', 'b'].map((id) => creature(id, { equippedManifestations: ['combustion'] }));
  assert.deepEqual(codes(validatePreparation(setup(s, cs), data)), ['MANI_UNIQUE']);
});

test('10.3: Manifestacion de elemento incompatible; Global en cualquiera', () => {
  const s = summoner('ana', 'invocador', { manifestationRepertoire: ['cuerpo_fluido', 'juramento_de_las_hogueras'] });
  const a = creature('a', { equippedManifestations: ['cuerpo_fluido'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [a]), data)), ['MANI_ELEMENT']);
  const b = creature('b', { equippedManifestations: ['juramento_de_las_hogueras'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [b]), data)), []);
});

test('10.2 / 10.4: huecos por NV y repertorio', () => {
  const s = summoner('ana', 'invocador', { manifestationRepertoire: ['combustion', 'ignicion'] });
  const low = creature('a', { nv: 49, equippedManifestations: ['combustion', 'ignicion'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [low]), data)), ['MANI_SLOTS']);
  const high = creature('a', { nv: 50, equippedManifestations: ['combustion', 'ignicion'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [high]), data)), []);
  const unknown = creature('a', { equippedManifestations: ['marca_ardiente'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [unknown]), data)), ['MANI_REPERTOIRE']);
});

test('9.2-9.4: Fortaleza y Orientaciones', () => {
  const s = summoner('ana', 'adepto');
  const a = creature('a', { fortaleza: { atk: 16, spe: 15, def: 1.5 }, orientations: ['atk', 'spe', 'def'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [a]), data)), ['FORT_CAPACITY', 'FORT_INTEGER', 'FORT_MAX_STAT', 'FORT_ORIENTATIONS']);
  const arc = summoner('z', 'arconte');
  const b = creature('b', { fortaleza: { atk: 26 } });
  assert.deepEqual(codes(validatePreparation(setup(arc, [b]), data)), ['FORT_MAX_25']);
});

test('Tecnica especial de otra especie; forma anterior permitida', () => {
  const s = summoner('ana');
  const a = creature('a', { speciesId: 'prueba', equippedTechniques: ['ariete_draconico'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [a]), data)), ['TECH_SPECIES']);
  const b = creature('b', { speciesId: 'valdrakar', types: ['fuego', 'mitico'], priorForms: ['brasal', 'dracendra'], equippedTechniques: ['ariete_draconico', 'golpe_candente'] });
  assert.deepEqual(codes(validatePreparation(setup(s, [b]), data)), []);
});

test('2.5: dos Vinculos de la misma linea (incluye no preparados)', () => {
  const s = summoner('ana');
  const a = creature('a', { transfigurationLine: 'linea_brasal' });
  const other = creature('x', { transfigurationLine: 'linea_brasal' });
  const v = validatePreparation({ ...setup(s, [a]), otherBonds: [other] }, data);
  assert.deepEqual(codes(v), ['LINE_UNIQUE']);
});

test('13.4 / 7.2: despliegue inicial', () => {
  const single = summoner('ana', 'iniciado');
  const cs = [creature('a'), creature('b')];
  assert.ok(codes(validatePreparation(setup(single, cs, ['a', 'b']), data)).includes('DEPLOY_POSITIONS'));
  assert.ok(codes(validatePreparation(setup(summoner('b'), cs, ['zzz']), data)).includes('DEPLOY_NOT_PREPARED'));
});

test('el validador devuelve todos los errores, con referencia de seccion', () => {
  const s = summoner('ana', 'despertado', { manifestationRepertoire: ['combustion'] });
  const cs = ['a', 'b', 'c', 'd', 'e'].map((id) => creature(id, { nv: 30, equippedTechniques: ['envite_ardiente', 'conflagracion', 'impulso_hidraulico'], equippedManifestations: ['combustion', 'cuerpo_fluido'] }));
  const v = validatePreparation(setup(s, cs), data);
  const found = new Set(codes(v));
  for (const c of ['PREP_MAX_4', 'TECH_LOCAL_COST', 'AMPLITUDE', 'MANI_UNIQUE', 'MANI_ELEMENT', 'MANI_SLOTS', 'MANI_REPERTOIRE']) assert.ok(found.has(c), c);
  assert.ok(v.every((x) => x.ruleRef.length > 0));
});

const bare = (id: string, over: Partial<BondedCreatureInput> = {}): BondedCreatureInput => {
  const { types: _t, baseStatsNV50: _b, ...rest } = creature(id);
  return { ...rest, ...over };
};
const sideOf = (cs: BondedCreatureInput[]): SideSetupInput => ({ summoner: summoner('ana'), preparation: { creatures: cs }, initialDeployment: [cs[0]!.id] });

test('CANON-CREATURES: tipos y estadisticas de la ficha si la instancia los omite; si los declara distintos, aviso', () => {
  const st = createBattle(data, [sideOf([bare('a', { speciesId: 'brasal' })]), sideOf([bare('b', { speciesId: 'brasal' })])], { seed: 1 });
  const a = st.sides[0].combatants[0]!.creature;
  assert.deepEqual(a.types, ['fuego']);
  assert.deepEqual(a.baseStatsNV50, data.species.get('brasal')!.baseStatsNV50);
  assert.equal(a.transfigurationLine, 'brasal');
  assert.equal(a.canTransfigure, true);
  const v = validatePreparation(setup(summoner('ana'), [creature('a', { speciesId: 'brasal' })]), data);
  assert.deepEqual(v.map((x) => x.code), ['CRE_SPECIES_STATS']);
});

test('CANON-CREATURES: tecnicas por nivel, entrenamiento y exclusivas de preformas', () => {
  const at = (speciesId: string, nv: number, t: string) => codes(validatePreparation(sideOf([bare('a', { speciesId, nv, equippedTechniques: [t] })]), data));
  assert.deepEqual(at('brasal', 11, 'golpe_candente'), ['TECH_LEARNSET']);
  assert.deepEqual(at('brasal', 12, 'golpe_candente'), []);
  assert.deepEqual(at('brasal', 50, 'romper_guardia'), []);
  assert.deepEqual(at('brasal', 50, 'chorro'), ['TECH_LEARNSET']);
  assert.deepEqual(at('dracendra', 30, 'golpe_candente'), []);
  assert.deepEqual(at('valdrakar', 35, 'fauces_incandescentes'), []);
});

test('CANON-CREATURES: NV minimo de cada forma', () => {
  const nv = (speciesId: string, n: number) => codes(validatePreparation(sideOf([bare('a', { speciesId, nv: n })]), data));
  assert.deepEqual(nv('dracendra', 17), ['CRE_FORM_NV']);
  assert.deepEqual(nv('dracendra', 18), []);
  assert.deepEqual(nv('valdrakar', 34), ['CRE_FORM_NV']);
  assert.deepEqual(nv('valdrakar', 35), []);
});

test('Horda: el Ataque del cadaver sale de la ficha si es una especie de la guia; si no, es obligatorio', () => {
  const h = (speciesId: string) => bare('h', { speciesId: 'holomicor', nv: 40, equippedTechniques: ['horda'], horde: [0, 1, 2].map(() => ({ speciesId, techniqueId: 'embestida' })) });
  assert.deepEqual(codes(validatePreparation(sideOf([h('lobo')]), data)), ['HORDE_CORPSE_STATS', 'HORDE_CORPSE_STATS', 'HORDE_CORPSE_STATS']);
  const st = createBattle(data, [sideOf([h('brasal')]), sideOf([bare('b', { speciesId: 'brasal' })])], { seed: 1 });
  assert.deepEqual(st.sides[0].combatants[0]!.creature.horde!.map((x) => x.atkNV50), [85, 85, 85]);
});
