import type { BondedCreature, PersistentStatus, StageKey, StatBlock, Summoner } from './types.js';
import type { RngState } from '../rng.js';
import type { BattleEvent } from '../log/events.js';
import type { EffectsMode } from '../effects/availability.js';

export type SideIndex = 0 | 1;
export type Location = 'intermedio' | 'field' | 'defeated';

export interface ChargeState {
  techniqueId: string;
  target: TargetDecl;
}

export interface Combatant {
  uid: string;
  side: SideIndex;
  creature: BondedCreature;
  stable: StatBlock;
  maxHp: number;
  hp: number;
  stages: Record<StageKey, number>;
  statuses: PersistentStatus[];
  location: Location;
  positionId: string | null;
  dodgeStreak: number;
  charging: ChargeState | null;
  lastTurnTechniqueId: string | null;
  turnsMaterialized: number;
  presentAtDeclaration: boolean;
  dodgingThisRound: boolean;
}

export interface Position {
  id: string;
  side: SideIndex;
  slot: number;
  temporary: boolean;
  openedRound: number;
  occupantUid: string | null;
  partialUid: string | null;
}

export interface SideEffect {
  id: string;
  sourceUid: string | null;
  roundsLeft: number;
  data: Record<string, unknown>;
}

export interface SideState {
  index: SideIndex;
  summoner: Summoner;
  combatants: Combatant[];
  positions: Position[];
  sideEffects: SideEffect[];
  surrendered: boolean;
}

export interface EnvironmentState {
  kind: 'weather' | 'field' | 'anomaly';
  id: string;
  sourceUid: string | null;
  sinceRound: number;
}

export interface BattleConfig {
  effectsMode: EffectsMode;
  multiHitDistribution: 'uniform';
  maxRounds: number;
  maxChainDepth: number;
}

export const DEFAULT_CONFIG: BattleConfig = {
  effectsMode: 'strict',
  multiHitDistribution: 'uniform',
  maxRounds: 100,
  maxChainDepth: 64,
};

export type Outcome =
  | { kind: 'victory'; winner: SideIndex; reason: string }
  | { kind: 'draw'; reason: string };

export type Phase = 'deployment' | 'round_start' | 'declaration' | 'switches' | 'dodges' | 'actions' | 'close' | 'ended';

export interface BattleState {
  config: BattleConfig;
  round: number;
  phase: Phase;
  sides: [SideState, SideState];
  environment: EnvironmentState | null;
  rng: RngState;
  log: BattleEvent[];
  nextEventId: number;
  outcome: Outcome | null;
}

export type TargetDecl =
  | { kind: 'position'; positionId: string }
  | { kind: 'sequence'; positionIds: string[] }
  | { kind: 'perHit'; positionIds: string[] }
  | { kind: 'auto' };

export type Action =
  | { kind: 'technique'; techniqueId: string; target: TargetDecl }
  | { kind: 'dodge' }
  | { kind: 'switch'; incomingId: string }
  | { kind: 'partial'; creatureId: string; techniqueId: string; target: TargetDecl }
  | { kind: 'surrender' };

export type Declarations = Record<string, Action>;
