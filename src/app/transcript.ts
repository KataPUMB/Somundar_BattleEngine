import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let chunks: string[] | null = null;

/** Copia todo lo que se escribe por la salida estandar; devuelve la funcion que la detiene y guarda el texto en `path` */
export function startTranscript(path: string): () => void {
  const buffer: string[] = [];
  chunks = buffer;
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    buffer.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return (original as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  return () => {
    process.stdout.write = original;
    chunks = null;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer.join(''), 'utf-8');
  };
}

/** La respuesta tecleada no pasa por la salida estandar; se anota para que el log la muestre como en pantalla */
export function recordInput(line: string): void {
  chunks?.push(`${line}\n`);
}
