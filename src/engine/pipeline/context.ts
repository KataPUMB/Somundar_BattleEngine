import type { GameData } from '../../data/schema.js';
import type { Action, BattleState, Combatant, Position, SideIndex, SideState } from '../model/battle.js';
import { emit, type RollRecord } from '../log/events.js';
import { nextFloat } from '../rng.js';

export interface Controllers {
  chooseReplacement?(st: Readonly<BattleState>, side: SideIndex, positionId: string, candidates: string[]): string;
  chooseOptionalSwitch?(st: Readonly<BattleState>, uid: string, candidates: string[]): string | null;
}

export interface PendingSelfSwitch {
  uid: string;
  mode: 'forced' | 'optional';
  ignoreRestrictions: boolean;
  random?: boolean;
  source: string;
  cause?: number;
}

export interface EngineCtx {
  data: GameData;
  st: BattleState;
  controllers: Controllers;
  depth?: number;
  declared?: Map<string, Action>;
  selfSwitches?: PendingSelfSwitch[];
  pendingReplacements?: string[];
  /** tecnicas en curso: sus Reemplazos e Intercambios forzados esperan a que terminen (28.5) */
  inTechnique?: number;
  chainDepth?: number;
}

export function sideOf(st: BattleState, i: SideIndex): SideState {
  return st.sides[i];
}

export function allCombatants(st: BattleState): Combatant[] {
  return [...st.sides[0].combatants, ...st.sides[1].combatants];
}

export function combatant(st: BattleState, uid: string): Combatant {
  const c = allCombatants(st).find((x) => x.uid === uid);
  if (!c) throw new Error(`combatiente desconocido: ${uid}`);
  return c;
}

export function allPositions(st: BattleState): Position[] {
  return [...st.sides[0].positions, ...st.sides[1].positions];
}

export function findPosition(st: BattleState, id: string): Position | undefined {
  return allPositions(st).find((p) => p.id === id);
}

export function occupantOf(st: BattleState, positionId: string): Combatant | null {
  const p = findPosition(st, positionId);
  return p?.occupantUid ? combatant(st, p.occupantUid) : null;
}

export function positionId(side: SideIndex, slot: number): string {
  return `S${side}P${slot}`;
}

export function roll(ctx: EngineCtx, purpose: string, thresholdPct: number): RollRecord {
  if (thresholdPct >= 100) return { purpose, roll: null, threshold: thresholdPct, result: true };
  if (thresholdPct <= 0) return { purpose, roll: null, threshold: thresholdPct, result: false };
  const r = nextFloat(ctx.st.rng) * 100;
  return { purpose, roll: r, threshold: thresholdPct, result: r < thresholdPct };
}

// CANON-MECHANICS 18.2-18.3: orden descendente por claves; empates exactos al azar registrado
export function orderDesc<T>(ctx: EngineCtx, items: T[], keys: (item: T) => number[], purpose: string, label: (item: T) => string): T[] {
  const withKeys = items.map((item) => ({ item, k: keys(item) }));
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (b[i] ?? 0) - (a[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  withKeys.sort((a, b) => cmp(a.k, b.k));
  const out: T[] = [];
  let i = 0;
  while (i < withKeys.length) {
    let j = i + 1;
    while (j < withKeys.length && cmp(withKeys[i]!.k, withKeys[j]!.k) === 0) j++;
    const group = withKeys.slice(i, j).map((x) => x.item);
    if (group.length > 1) {
      const rolls: RollRecord[] = [];
      for (let a = group.length - 1; a > 0; a--) {
        const r = nextFloat(ctx.st.rng);
        const b = Math.floor(r * (a + 1));
        rolls.push({ purpose: `${purpose}:tie`, roll: r * 100, threshold: 100, result: true });
        [group[a], group[b]] = [group[b]!, group[a]!];
      }
      emit(ctx.st, {
        type: 'tie_break',
        data: { purpose, order: group.map(label), gap: group.length > 2 ? 'GAP-TIE-GROUP' : undefined },
        rolls,
        ruleRef: 'CANON-MECHANICS 18.3',
      });
    }
    out.push(...group);
    i = j;
  }
  return out;
}
