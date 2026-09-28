import type { BattleState, Phase } from '../model/battle.js';

export interface RollRecord {
  purpose: string;
  roll: number | null;
  threshold: number;
  result: boolean;
}

export interface BattleEvent {
  id: number;
  round: number;
  phase: Phase;
  type: string;
  actor?: string;
  targets?: string[];
  data?: Record<string, unknown>;
  rolls?: RollRecord[];
  cause?: number;
  ruleRef?: string;
}

export type EventInput = Omit<BattleEvent, 'id' | 'round' | 'phase'>;

export function emit(st: BattleState, ev: EventInput): number {
  const id = st.nextEventId++;
  st.log.push({ id, round: st.round, phase: st.phase, ...ev });
  return id;
}
