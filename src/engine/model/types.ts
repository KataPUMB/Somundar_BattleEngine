export const TYPE_IDS = ['fuego', 'agua', 'tierra', 'aire', 'rayo', 'planta', 'luz', 'oscuridad', 'mitico'] as const;
export type TypeId = (typeof TYPE_IDS)[number];

export const STAT_KEYS = ['hp', 'atk', 'matk', 'def', 'mdef', 'spe'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatBlock = Record<StatKey, number>;

export const STAGE_KEYS = ['atk', 'matk', 'def', 'mdef', 'spe', 'accuracy'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STATUS_IDS = [
  'quemado', 'saturado', 'enraizado', 'agrietado', 'paralizado', 'desorientado', 'espiritu_cercenado', 'desvinculado',
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const ESTAMENTOS = ['despertado', 'iniciado', 'adepto', 'invocador', 'magister', 'arconte'] as const;
export type Estamento = (typeof ESTAMENTOS)[number];

export type Simultaneity = 'single' | 'adept_temporary' | 'stable';

export interface AdeptSustain {
  maxRounds?: number;
  chancePct?: number;
}

export interface Summoner {
  id: string;
  name: string;
  estamento: Estamento;
  /** null = sin restriccion global (CANON-MECHANICS 8.6) */
  amplitude: number | null;
  fortalezaCapacity: number;
  fortalezaMaxPerStat: number;
  simultaneity: Simultaneity;
  partialMaterialization: boolean;
  manifestationRepertoire: string[];
  adeptSustain?: AdeptSustain;
}

export interface PersistentStatus {
  id: StatusId;
  /** turnos materializados restantes por restriccion (clave = kind de la restriccion) */
  counters: Record<string, number>;
}

export interface BondedCreature {
  id: string;
  name?: string;
  speciesId: string;
  form?: string;
  transfigurationLine?: string | null;
  priorForms?: string[];
  types: TypeId[];
  nv: number;
  depth?: number;
  depthFactor?: number;
  baseStatsNV50: StatBlock;
  fortaleza: Partial<StatBlock>;
  orientations: StatKey[];
  equippedTechniques: string[];
  equippedManifestations: string[];
  persistentStatuses: PersistentStatus[];
  hpCurrent?: number;
  /** aptitud fijada por Instinto adoptado (Zanolah) */
  instinct?: 'atk' | 'def' | 'spe';
  /** puede Transfigurarse todavia (Poder latente); explicito mientras falte CANON-CREATURES */
  canTransfigure?: boolean;
  /** cadaveres de Horda (Holomicor); explicitos mientras falte CANON-CREATURES */
  horde?: HordeCorpse[];
}

export interface HordeCorpse {
  speciesId: string;
  atkNV50: number;
  techniqueId: string;
}

export interface Preparation {
  creatures: BondedCreature[];
}

export interface SideSetup {
  summoner: Summoner;
  preparation: Preparation;
  /** Vinculos no preparados, solo para comprobar 2.5 */
  otherBonds?: BondedCreature[];
  /** ids de criaturas preparadas para las posiciones iniciales; null deja la posicion vacia */
  initialDeployment: (string | null)[];
}
