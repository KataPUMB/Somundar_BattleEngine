import { readSync } from 'node:fs';
import type { GameData } from '../data/schema.js';
import type { Action, BattleState, Declarations, SideIndex, TargetDecl } from '../engine/model/battle.js';
import type { ActionOption } from '../engine/legality/actions.js';
import type { Policy } from '../engine/ai/random.js';
import type { RoundStartChoice } from '../engine/pipeline/battle.js';
import { dodgeChance } from '../engine/rules/accuracy.js';
import { creatureName, statusLine, techName } from './format.js';

function readLineSync(): string {
  const buf = Buffer.alloc(1);
  let s = '';
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EAGAIN') continue;
      throw e;
    }
    if (n === 0) {
      if (s === '') throw new Error('entrada cerrada');
      break;
    }
    const ch = buf.toString('utf8', 0, 1);
    if (ch === '\n') break;
    s += ch;
  }
  return s.replace(/\r$/, '').trim();
}

function ask(question: string, max: number, allowZero = false): number {
  for (;;) {
    process.stdout.write(`${question} `);
    const n = Number(readLineSync());
    if (Number.isInteger(n) && n <= max && (n >= 1 || (allowZero && n === 0))) return n;
    console.log(`  Opcion no valida (${allowZero ? 0 : 1}-${max}).`);
  }
}

function printBoard(data: GameData, st: BattleState, side: SideIndex, title = `ronda ${st.round}`): void {
  const foe: SideIndex = side === 0 ? 1 : 0;
  console.log(`\n--- ${st.sides[side].summoner.name}: ${title} ---`);
  for (const s of [foe, side]) {
    for (const p of st.sides[s].positions) {
      const c = p.occupantUid ? st.sides[s].combatants.find((x) => x.uid === p.occupantUid)! : null;
      console.log(`  ${p.id}${p.temporary ? '*' : ''} ${s === side ? '(tuya)' : '(rival)'}: ${c ? `${creatureName(st, c.uid)} ${statusLine(c, data)}` : 'vacia'}`);
    }
  }
  const reserves = st.sides[side].combatants.filter((c) => c.location !== 'field');
  if (reserves.length) console.log(`  Intermedio: ${reserves.map((c) => `${c.creature.name ?? c.creature.id} ${c.location === 'defeated' ? '(derrotada)' : statusLine(c, data)}`).join(' | ')}`);
  const foeLeft = st.sides[foe].combatants.filter((c) => c.location === 'intermedio').length;
  console.log(`  Reservas viables del rival: ${foeLeft}`);
}

function describe(data: GameData, st: BattleState, positionId: string, o: ActionOption): string {
  const a = o.action;
  switch (a.kind) {
    case 'technique': {
      const t = data.techniques.get(a.techniqueId);
      return `${techName(data, a.techniqueId)} [${t?.class}, ${t?.type ?? 'sin tipo'}, PB ${t?.power?.perHit ?? '-'}${t?.power?.hits && t.power.hits.max > 1 ? ` x${t.power.hits.min}-${t.power.hits.max}` : ''}, prio ${t?.priority}, ${t?.targeting}]${o.reason === 'ejecucion de la carga' ? ' (ejecutar carga)' : ''}`;
    }
    case 'partial': return `Materializacion parcial de ${a.creatureId}: ${techName(data, a.techniqueId)}`;
    case 'dodge': {
      const occ = st.sides.flatMap((s) => s.positions).find((p) => p.id === positionId)?.occupantUid;
      const streak = st.sides.flatMap((s) => s.combatants).find((c) => c.uid === occ)?.dodgeStreak ?? 0;
      return `Esquiva (${dodgeChance(streak)}% de exito)`;
    }
    case 'switch': return `Intercambio -> ${a.incomingId}`;
    case 'surrender': return 'Rendirse';
  }
}

function chooseTarget(st: BattleState, side: SideIndex, o: ActionOption): TargetDecl {
  if (o.targeting === 'all') return { kind: 'auto' };
  const foe: SideIndex = side === 0 ? 1 : 0;
  const positions = [...st.sides[foe].positions, ...st.sides[side].positions];
  const label = (id: string) => {
    const p = positions.find((x) => x.id === id)!;
    return `${id} ${p.side === side ? '(tuya)' : '(rival)'}: ${p.occupantUid ? creatureName(st, p.occupantUid) : 'vacia'}`;
  };
  positions.forEach((p, i) => console.log(`    ${i + 1}) ${label(p.id)}`));
  if (o.targeting === 'single') return { kind: 'position', positionId: positions[ask('  Objetivo:', positions.length) - 1]!.id };
  const seq: string[] = [];
  for (;;) {
    const n = ask(`  Posicion ${seq.length + 1} de la secuencia (0 = terminar):`, positions.length, seq.length > 0);
    if (n === 0) break;
    seq.push(positions[n - 1]!.id);
  }
  return { kind: 'sequence', positionIds: seq };
}

export function humanPolicy(data: GameData): Policy {
  return {
    roundStart(view, side) {
      const s = view.sides[side];
      const reserves = s.combatants.filter((c) => c.location === 'intermedio' && c.hp > 0);
      const empty = s.positions.filter((p) => p.occupantUid === null);
      const canOpen = s.summoner.simultaneity === 'adept_temporary' && s.positions.length < 2;
      if (reserves.length === 0 || (!canOpen && empty.length === 0)) return [];
      printBoard(data, view as BattleState, side, `establecimiento de posiciones de la ronda ${view.round + 1}`);
      const where = canOpen ? 'abrir una segunda posicion temporal' : `ocupar ${empty[0]!.id}`;
      console.log(`  Puedes ${where} materializando una criatura completa:`);
      reserves.forEach((c, i) => console.log(`    ${i + 1}) ${c.creature.name ?? c.creature.id} ${statusLine(c, data)}`));
      const n = ask('  Criatura (0 = no):', reserves.length, true);
      if (n === 0) return [];
      const choice: RoundStartChoice = { side, creatureId: reserves[n - 1]!.creature.id };
      return canOpen ? [choice] : [{ ...choice, positionId: empty[0]!.id }];
    },
    declare(view, side, legal) {
      const st = view as BattleState;
      printBoard(data, st, side);
      const out: Declarations = {};
      for (const [pid, opts] of legal) {
        const occ = st.sides[side].positions.find((p) => p.id === pid)?.occupantUid;
        if (!occ && opts.length === 0) continue;
        console.log(`\n  ${pid}: ${occ ? creatureName(st, occ) : 'posicion vacia'}`);
        const ok = opts.filter((o) => o.legal);
        ok.forEach((o, i) => console.log(`    ${i + 1}) ${describe(data, st, pid, o)}`));
        for (const o of opts.filter((x) => !x.legal)) console.log(`     -  ${describe(data, st, pid, o)}: no disponible (${o.reason}${o.ruleRef ? `; ${o.ruleRef}` : ''})`);
        const n = ask('  Accion:', ok.length, !occ);
        if (n === 0) continue;
        const o = ok[n - 1]!;
        let action: Action = o.action;
        if ((action.kind === 'technique' || action.kind === 'partial') && o.reason !== 'ejecucion de la carga') {
          action = { ...action, target: chooseTarget(st, side, o) };
        }
        out[pid] = action;
      }
      return out;
    },
  };
}

export function askReplacement(st: BattleState, positionId: string, candidates: string[]): string {
  console.log(`\n  Reemplazo forzado en ${positionId}:`);
  candidates.forEach((u, i) => console.log(`    ${i + 1}) ${creatureName(st, u)}`));
  return candidates[ask('  Criatura:', candidates.length) - 1]!;
}
