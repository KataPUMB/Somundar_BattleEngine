import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStat, levelFactor, stableStat, stageMultiplier, clampStage } from '../engine/rules/stats.js';
import { dodgeChance, finalAccuracy } from '../engine/rules/accuracy.js';
import { finalizeDamage, isImmuneToStatus, rawDamage, typeMultiplier } from '../engine/rules/combat.js';
import { cumulativeDepth, depthCostToNext, nvFromDepth, combatDepthGain } from '../engine/rules/depth.js';
import { loadData } from './helpers.js';

const data = loadData();
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('5.1 Factor de Nivel: tabla de referencia', () => {
  const table: [number, number][] = [[1, 0.6733], [5, 0.7], [10, 0.7333], [35, 0.9], [50, 1], [75, 1.1667], [100, 1.3333]];
  for (const [nv, f] of table) close(levelFactor(nv), f, 1e-4);
});

test('33: 240 a NV100 -> 320; con +25% Fortaleza -> 400', () => {
  assert.equal(stableStat(240, 100), 320);
  assert.equal(stableStat(240, 100, 25), 400);
});

test('21.1: redondeo unico tras Nivel y Fortaleza', () => {
  assert.equal(stableStat(101, 7, 3), Math.round(101 * (2 / 3 + 7 / 150) * 1.03));
});

test('21.2: tabla de etapas y limite [-6,+6] (ISS-004: -1 = x0,667)', () => {
  assert.equal(stageMultiplier(-1), 0.667);
  assert.equal(stageMultiplier(6), 4);
  assert.equal(stageMultiplier(9), 4);
  assert.equal(stageMultiplier(-9), 0.25);
  assert.equal(clampStage(-7), -6);
});

test('21.3: +25% y -50% directos -> x0,75', () => {
  const mods = [{ pct: 25, fromStatus: false, source: 'a' }, { pct: -50, fromStatus: false, source: 'b' }];
  close(effectiveStat(100, 0, mods), 75);
});

test('21.3: ninguna estadistica efectiva baja de 1', () => {
  assert.equal(effectiveStat(10, -6, [{ pct: -200, fromStatus: false, source: 'x' }]), 1);
});

test('24.1: Paralizado + Enraizado -> Velocidad -50%, no -75%', () => {
  const mods = [{ pct: -50, fromStatus: true, source: 'paralizado' }, { pct: -25, fromStatus: true, source: 'enraizado' }];
  close(effectiveStat(200, 0, mods), 100);
  const withOther = [...mods, { pct: 20, fromStatus: false, source: 'manifestacion' }];
  close(effectiveStat(200, 0, withOther), 140);
});

test('20.2: 100% con Desorientado -> 75%; + Tercer ojo (+10 pp) -> 85%', () => {
  assert.equal(finalAccuracy(100, { relativePct: [-25], percentagePoints: [] }), 75);
  assert.equal(finalAccuracy(100, { relativePct: [-25], percentagePoints: [10] }), 85);
  assert.equal(finalAccuracy(100, { relativePct: [-25], percentagePoints: [] }, true), 100);
  assert.equal(finalAccuracy(90, { relativePct: [50], percentagePoints: [] }), 100);
});

test('23.1-23.4: formula de dano, M, R e ignorar Defensa (constante configurable)', () => {
  const K = 0.75;
  const base = { power: 100, attack: 400, defense: 100, damagePcts: [], typeMult: 1, halvings: 0, ignoreDefense: false, constant: K, stab: 1 };
  close(rawDamage(base), K * 400 * 2);
  close(rawDamage({ ...base, damagePcts: [100, -50] }), K * 400 * 2 * 1.5);
  close(rawDamage({ ...base, halvings: 2 }), (K * 400 * 2) / 4);
  close(rawDamage({ ...base, ignoreDefense: true }), K * 400);
  close(rawDamage({ ...base, constant: K * 1.25 }), K * 1.25 * 400 * 2);
  assert.equal(rawDamage({ ...base, damagePcts: [-150] }), 0);
});

test('23.5: dano 1400 contra 1000/1000 -> 1000; con 170 actual -> perdida 170', () => {
  assert.deepEqual(finalizeDamage(1400, 1000, 1000), { raw: 1400, calculated: 1000, loss: 1000 });
  assert.equal(finalizeDamage(1400, 1000, 170).loss, 170);
  assert.equal(finalizeDamage(12.5, 1000, 1000).calculated, 13);
});

test('22.2: duotipo multiplica; sin STAB; tecnica sin tipo x1', () => {
  assert.equal(typeMultiplier(data.types, 'agua', ['fuego', 'tierra']), 4);
  assert.equal(typeMultiplier(data.types, 'fuego', ['agua', 'planta']), 1);
  assert.equal(typeMultiplier(data.types, 'fuego', ['agua', 'mitico']), 0.25);
  assert.equal(typeMultiplier(data.types, null, ['agua']), 1);
});

test('24.1: inmunidades por tipo y de Mitico', () => {
  assert.ok(isImmuneToStatus(data.types, ['fuego', 'mitico'], 'quemado'));
  assert.ok(isImmuneToStatus(data.types, ['fuego', 'mitico'], 'desvinculado'));
  assert.ok(isImmuneToStatus(data.types, ['fuego', 'mitico'], 'espiritu_cercenado'));
  assert.ok(!isImmuneToStatus(data.types, ['fuego', 'mitico'], 'saturado'));
  assert.ok(isImmuneToStatus(data.types, ['fuego', 'oscuridad'], 'desvinculado'));
});

test('4.2-4.3: Profundidad', () => {
  assert.equal(cumulativeDepth(100, 1), 49500);
  close(cumulativeDepth(100, 0.8), 39600);
  assert.equal(cumulativeDepth(100, 2), 99000);
  assert.equal(depthCostToNext(10, 1.5), 150);
  assert.equal(nvFromDepth(cumulativeDepth(37, 1.2), 1.2), 37);
  assert.equal(nvFromDepth(cumulativeDepth(37, 1.2) - 1, 1.2), 36);
  assert.equal(combatDepthGain(40, 1.5), 120);
});

test('17: Esquiva 100 / 50 / 12,5 / 0', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(dodgeChance), [100, 50, 12.5, 0, 0, 0]);
});
