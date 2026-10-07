import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordInput, startTranscript } from '../app/transcript.js';

test('La transcripcion guarda la salida y las respuestas tecleadas, creando la carpeta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'battlesim-'));
  const path = join(dir, 'logs', 'combate.log');
  const stop = startTranscript(path);
  process.stdout.write('  Accion: ');
  recordInput('3');
  process.stdout.write('Ronda 2\n');
  stop();
  recordInput('no se guarda');
  assert.equal(readFileSync(path, 'utf-8'), '  Accion: 3\nRonda 2\n');
  rmSync(dir, { recursive: true });
});
