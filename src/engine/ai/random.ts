import type { Action, BattleState, Declarations, SideIndex, TargetDecl } from '../model/battle.js';
import type { ActionOption } from '../legality/actions.js';
import type { ColonyChoice, RoundStartDecision } from '../pipeline/battle.js';
import { availableCorpses } from '../rules/horde.js';
import { nextFloat, nextInt, type RngState } from '../rng.js';

export interface Policy {
  roundStart?(view: Readonly<BattleState>, side: SideIndex, rng: RngState): RoundStartDecision[];
  declare(view: Readonly<BattleState>, side: SideIndex, legal: Map<string, ActionOption[]>, rng: RngState): Declarations;
}

function pick<T>(rng: RngState, xs: T[]): T {
  return xs[nextInt(rng, 0, xs.length - 1)]!;
}

function enemyTargets(view: Readonly<BattleState>, side: SideIndex): string[] {
  const foe = view.sides[side === 0 ? 1 : 0].positions;
  const occupied = foe.filter((p) => p.occupantUid !== null).map((p) => p.id);
  return occupied.length > 0 ? occupied : foe.map((p) => p.id);
}

export function withTarget(view: Readonly<BattleState>, side: SideIndex, opt: ActionOption, rng: RngState): Action {
  const a = opt.action;
  if (a.kind !== 'technique' && a.kind !== 'partial') return a;
  if (opt.reason === 'ejecucion de la carga') return a;
  const choice = opt.choices ? pick(rng, opt.choices) : undefined;
  let target: TargetDecl;
  if (opt.targetSide === 'self' || opt.targetSide === 'side' || opt.targeting === 'all') target = { kind: 'auto' };
  else if (opt.targetSide === 'ally') {
    const own = view.sides[side].positions;
    const occupied = own.filter((p) => p.occupantUid !== null).map((p) => p.id);
    target = { kind: 'position', positionId: pick(rng, occupied.length ? occupied : own.map((p) => p.id)) };
  } else {
    const enemies = enemyTargets(view, side);
    target = opt.targeting === 'multi' ? { kind: 'sequence', positionIds: enemies } : { kind: 'position', positionId: pick(rng, enemies) };
  }
  return choice === undefined ? { ...a, target } : { ...a, target, choice };
}

export const randomLegalPolicy: Policy = {
  roundStart(view, side, rng) {
    const s = view.sides[side];
    const out: RoundStartDecision[] = [];
    for (const c of s.combatants) {
      if (!c.colony || c.location !== 'field') continue;
      const max = availableCorpses(c.colony);
      if (max <= c.colony.materialized || nextFloat(rng) >= 0.3) continue;
      const choice: ColonyChoice = { side, creatureId: c.creature.id, materializeCorpses: nextFloat(rng) < 0.3 ? 'all' : nextInt(rng, c.colony.materialized + 1, max) };
      out.push(choice);
    }
    if (s.summoner.simultaneity !== 'adept_temporary' || s.positions.length >= 2 || nextFloat(rng) < 0.5) return out;
    const reserves = s.combatants.filter((c) => c.location === 'intermedio' && c.hp > 0);
    return reserves.length > 0 ? [...out, { side, creatureId: pick(rng, reserves).creature.id }] : out;
  },
  declare(view, side, legal, rng) {
    const out: Declarations = {};
    for (const [pid, opts] of legal) {
      const legalOpts = opts.filter((o) => o.legal && o.action.kind !== 'surrender' && o.action.kind !== 'corpses');
      const useful = legalOpts.filter((o) => !o.futile);
      const ok = useful.length > 0 ? useful : legalOpts;
      const occupied = view.sides[side].positions.find((p) => p.id === pid)?.occupantUid !== null;
      if (ok.length === 0) {
        if (occupied) out[pid] = { kind: 'surrender' };
        continue;
      }
      if (!occupied && nextFloat(rng) < 0.5) continue;
      out[pid] = withTarget(view, side, pick(rng, ok), rng);
    }
    return out;
  },
};
