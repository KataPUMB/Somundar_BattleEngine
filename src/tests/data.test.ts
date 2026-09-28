import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../data/loader.js';
import { validateOverrideFile } from '../data/validate.js';
import { buildCoverageReport } from '../data/coverage.js';
import { DATA_DIR } from './helpers.js';

const { data, issues } = loadGameData(DATA_DIR);

test('Data/ carga sin errores de esquema', () => {
  assert.deepEqual(issues.filter((i) => i.severity === 'error'), []);
  assert.equal(data.techniques.size, 343);
  assert.equal(data.manifestations.size, 138);
  assert.equal(data.statuses.size, 8);
  assert.equal(data.species.size, 160);
});

test('los parametros no numericos se reportan como avisos', () => {
  const ids = issues.filter((i) => i.severity === 'warning' && i.file === 'techniques.json').map((i) => i.id);
  assert.ok(ids.includes('horda'));
});

test('los overrides curados se enlazan sin tocar los JSON generados', () => {
  const t = data.techniques.get('golpe_candente')!;
  assert.deepEqual(t.override?.effects, []);
  assert.equal(t.overrideSource, 'effects/base_only.json');
  assert.ok(t.description.includes('Sin efecto adicional'));
});

test('validacion de overrides: ids inexistentes y DSL mal formada', () => {
  const errs = validateOverrideFile(
    {
      techniques: {
        no_existe: { effects: [] },
        aranazo: { effects: [{ trigger: 'nunca', target: 'self', ops: [{ op: 'damage' }] }] as never },
      },
      manifestations: { combustion: { effects: [{ trigger: 'passive', target: 'self', ops: [{ op: 'inventada' }] }] as never } },
    },
    'test.json', data.techniques, data.manifestations,
  );
  const msgs = errs.map((e) => `${e.id}: ${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith('no_existe')));
  assert.ok(msgs.some((m) => m.includes('trigger desconocido nunca')));
  assert.ok(msgs.some((m) => m.includes('op desconocida inventada')));
});

test('informe de cobertura coherente en strict y lenient', () => {
  const strict = buildCoverageReport(data, 'strict');
  const lenient = buildCoverageReport(data, 'lenient');
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(strict.techniques.byStatus), 343);
  assert.equal(strict.techniques.executable, (strict.techniques.byStatus.base_only_verified ?? 0) + (strict.techniques.byStatus.implemented ?? 0));
  assert.equal(lenient.techniques.executable, 343 - (lenient.techniques.byStatus.needs_handler ?? 0) - (lenient.techniques.byStatus.curated_pending ?? 0));
  assert.equal(strict.manifestations.executable, strict.manifestations.byStatus.implemented ?? 0);
  assert.deepEqual(strict.techniques.entries.filter((e) => !e.executable).map((e) => e.id), []);
  assert.equal(strict.manifestations.executable, 138);
});

test('condiciones desconocidas en el DSL se rechazan', () => {
  const errs = validateOverrideFile(
    { manifestations: { combustion: { effects: [{ trigger: 'passive', target: 'self', condition: { inventada: true }, ops: [{ op: 'modifyDamage' }] }] as never } } },
    'test.json', data.techniques, data.manifestations,
  );
  assert.ok(errs.some((e) => e.message.includes('condicion desconocida inventada')));
});
