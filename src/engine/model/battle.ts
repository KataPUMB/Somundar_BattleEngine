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
  turnsSinceEntry: number;
  actedThisRound: boolean;
  flinched: boolean;
  entryBonusesUsed: string[];
  marks: Mark[];
  damagedThisRound: boolean;
  lastDamageDealtRound: number | null;
  lastDamagingMissed: boolean;
  techUses: Record<string, number>;
  streak: { techniqueId: string; targetUid: string; count: number } | null;
  committedTechnique: string | null;
  everUsed: string[];
  onceUsed: string[];
}

export type Expiry =
  | { kind: 'exit' }
  | { kind: 'next_action' }
  | { kind: 'end_of_round'; round: number }
  | { kind: 'rounds'; left: number }
  | { kind: 'turns'; left: number };

export type MarkKind =
  | 'healing_mod' | 'incoming_accuracy' | 'outgoing_accuracy' | 'damage_taken' | 'retaliate_contact' | 'redirect'
  | 'no_withdraw' | 'periodic' | 'death' | 'next_damage_bonus' | 'sure_hit' | 'undermine' | 'stored_energy'
  | 'priority_mod' | 'temp_stage' | 'reactive' | 'type_lock' | 'technique_lock' | 'tag';

// Efecto temporal fijado sobre una criatura; toda marca desaparece con cualquier Salida (GAP-MARKS-EXIT)
export interface Mark {
  kind: MarkKind;
  source: string;
  by: string;
  expires: Expiry;
  uses?: number;
  barrier?: boolean;
  evasion?: boolean;
  params: Record<string, unknown>;
}

export type SideMod =
  | { kind: 'damage_taken'; pct: number; classes?: string[]; consume?: boolean }
  | { kind: 'halve'; classes?: string[] }
  | { kind: 'stat'; stat: string; pct: number }
  | { kind: 'healing'; pct: number };

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
  barrier: boolean;
  mods: SideMod[];
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

export interface FieldState {
  trickRoomRounds: number;
  priorityNullifiedRound: number | null;
  revelationRounds: number;
}

export interface BattleConfig {
  effectsMode: EffectsMode;
  multiHitDistribution: 'uniform';
  maxRounds: number;
  maxChainDepth: number;
  contactDefault: 'physical' | 'none';
}

export const DEFAULT_CONFIG: BattleConfig = {
  effectsMode: 'strict',
  multiHitDistribution: 'uniform',
  maxRounds: 100,
  maxChainDepth: 64,
  contactDefault: 'physical',
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
  field: FieldState;
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
  | { kind: 'technique'; techniqueId: string; target: TargetDecl; choice?: string }
  | { kind: 'dodge' }
  | { kind: 'switch'; incomingId: string }
  | { kind: 'partial'; creatureId: string; techniqueId: string; target: TargetDecl; choice?: string }
  | { kind: 'surrender' };

export type Declarations = Record<string, Action>;
