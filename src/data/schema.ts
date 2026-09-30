import type { StatKey, StatusId, TypeId } from '../engine/model/types.js';
import type { Condition, Effect } from '../engine/effects/dsl.js';

export type TechniqueCategory = 'anatomical' | 'elemental' | 'no_element' | 'special';
export type TechniqueClass = 'physical' | 'magical' | 'status';
export type Targeting = 'single' | 'multi' | 'all';

export interface TechniquePower {
  base: number | null;
  perHit: number | 'variable' | null;
  hits: { min: number; max: number } | null;
  effective: number | null;
}

export interface TechniqueData {
  id: string;
  name: string;
  category: TechniqueCategory;
  type: TypeId | null;
  class: TechniqueClass;
  power: TechniquePower | null;
  accuracy: number | string;
  bondCost: number;
  priority: number;
  targeting: Targeting;
  rarity: string | null;
  species: { number: number; name: string } | null;
  description: string;
  mechanics: Record<string, unknown>;
  source: { id: string; line: number };
}

export interface ManifestationData {
  id: string;
  name: string;
  element: TypeId | 'global';
  rarity: string;
  label: string | null;
  trigger: string;
  environmentKind: 'weather' | 'field' | 'anomaly' | null;
  effect: string[];
  text: string;
  mechanics: Record<string, unknown>;
  notes: string[];
  source: { id: string; line: number };
}

export interface TypesData {
  types: { id: TypeId; name: string }[];
  effectiveness: Record<TypeId, Record<TypeId, number>>;
  dualTypeRule: string;
  sameTypeBonus: boolean;
  immunities: Record<TypeId, StatusId[]>;
}

export type StatusRestrictionKind =
  | 'stat_cannot_increase'
  | 'no_voluntary_withdraw'
  | 'no_same_technique_consecutive'
  | 'dual_type_benefits_halved'
  | 'manifestations_disabled'
  | 'bond_communication_cut';

export interface StatusRestriction {
  kind: StatusRestrictionKind;
  turns: number;
  stat?: StatKey;
  except?: string;
}

export interface StatusData {
  id: StatusId;
  name: string;
  element: TypeId;
  statModifiersPct: Partial<Record<StatKey | 'accuracy' | 'healingReceived', number>>;
  damageOverTime?: { pctMaxHp: number; timing: string };
  restrictions: StatusRestriction[];
  section: string;
}

export type SpeciesTransfiguration =
  | { kind: 'level'; level: number }
  | { kind: 'apotheosis'; minLevel: number; event: string };

export interface LearnsetEntry {
  level: number;
  technique: string;
  exclusive: boolean;
}

export interface SpeciesData {
  id: string;
  number: number;
  name: string;
  source: { id: string; line: number };
  types: TypeId[] | null;
  powerCategory: string | null;
  rarity: string | null;
  /** como se pasa de esta forma a la siguiente */
  transfiguration: SpeciesTransfiguration | null;
  apotheosis: string | null;
  previousForm: string | null;
  nextForm: string | null;
  /** id de la primera forma de la linea */
  transfigurationLine: string | null;
  depthFactor: number | null;
  baseStatsNV50: Record<StatKey, number> | null;
  learnset: LearnsetEntry[];
  onTransfigure: string[];
  training: string[];
  signatureTechniques: string[];
}

export interface TechniqueOverride {
  effects?: Effect[];
  charge?: boolean;
  contact?: boolean;
  neverMiss?: boolean;
  targetSet?: 'all_enemies' | 'all_allies' | 'all_present';
  /** self: sin objetivo declarado; ally: posicion propia; side: efecto de lado o de campo sin impactos */
  targetSide?: 'self' | 'ally' | 'side';
  declareAs?: 'single';
  noConsecutiveUse?: boolean;
  chargeSkipEnvironment?: string[];
  usableIf?: Condition;
  choices?: string[];
  splashPct?: number;
  streak?: { pct: number; max: number };
  phases?: number;
  accuracyAssumed?: number;
  interceptSwitch?: { damagePct: number };
  requiresInstinct?: boolean;
  handler?: string;
  note?: string;
}

export interface ManifestationOverride {
  effects?: Effect[];
  worksWhileDesvinculado?: boolean;
  handler?: string;
  note?: string;
}

export interface OverrideFile {
  techniques?: Record<string, TechniqueOverride>;
  manifestations?: Record<string, ManifestationOverride>;
}

export interface Technique extends TechniqueData {
  override: TechniqueOverride | null;
  overrideSource: string | null;
}

export interface Manifestation extends ManifestationData {
  override: ManifestationOverride | null;
  overrideSource: string | null;
}

export interface GameData {
  techniques: Map<string, Technique>;
  manifestations: Map<string, Manifestation>;
  types: TypesData;
  statuses: Map<StatusId, StatusData>;
  species: Map<string, SpeciesData>;
}

export interface DataIssue {
  severity: 'error' | 'warning';
  file: string;
  id?: string;
  message: string;
}
