import type { GameData } from '../data/schema.js';
import type { BattleConfig, BattleState, Declarations, SideIndex } from '../engine/model/battle.js';
import type { SideSetupInput } from '../engine/model/types.js';
import { beginRound, createBattle, resolveRound } from '../engine/pipeline/battle.js';
import { legalActions, type ActionOption } from '../engine/legality/actions.js';
import type { Controllers } from '../engine/pipeline/context.js';
import type { Policy } from '../engine/ai/random.js';
import { createRng } from '../engine/rng.js';

export function legalActionsFor(data: GameData, state: BattleState, positionId: string): ActionOption[] {
  return legalActions({ data, st: state, controllers: {} }, positionId);
}

export function legalMap(data: GameData, state: BattleState, side: SideIndex): Map<string, ActionOption[]> {
  return new Map(state.sides[side].positions.map((p) => [p.id, legalActionsFor(data, state, p.id)]));
}

export interface RunOptions {
  seed: number;
  policySeed?: number;
  config?: Partial<BattleConfig>;
  controllers?: Controllers;
  onUpdate?: (st: BattleState) => void;
}

export function runBattle(data: GameData, setups: [SideSetupInput, SideSetupInput], policies: [Policy, Policy], opts: RunOptions): BattleState {
  let st = createBattle(data, setups, { seed: opts.seed, config: opts.config, controllers: opts.controllers });
  const prng = createRng(opts.policySeed ?? opts.seed ^ 0x9e3779b9);
  opts.onUpdate?.(st);
  while (!st.outcome) {
    const choices = ([0, 1] as SideIndex[]).flatMap((s) => policies[s].roundStart?.(st, s, prng) ?? []);
    st = beginRound(data, st, choices, opts.controllers);
    opts.onUpdate?.(st);
    // CANON-MECHANICS 14.1: cada politica decide sin ver la declaracion rival
    const decls: Declarations = {};
    for (const s of [0, 1] as SideIndex[]) Object.assign(decls, policies[s].declare(st, s, legalMap(data, st, s), prng));
    st = resolveRound(data, st, decls, opts.controllers);
    opts.onUpdate?.(st);
  }
  return st;
}
