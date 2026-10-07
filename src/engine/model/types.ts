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
  /** sustituye al nombre de la especie en el log y la consola */
  nickname?: string;
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
  /** puede Transfigurarse todavia (Poder latente); por defecto, si la especie tiene forma siguiente */
  canTransfigure?: boolean;
  /** cuerpos de la colonia de Holomicor, en orden de materializacion; cada grupo puede repetirse `count` veces */
  horde?: HordeCorpse[];
  /** tamano total de la colonia de Holomicor; escala la Vitalidad. Sin declarar: x1 y Horda de 3 impactos */
  totalCorpseCount?: number;
  /** cadaveres materializados al entrar en combate; por defecto, todos los disponibles */
  initialMaterializedCorpseCount?: number;
  /** cadaveres destruidos de forma permanente al empezar el combate; por defecto, 0 */
  destroyedCorpseCount?: number;
}

export interface HordeCorpse {
  speciesId: string;
  atkNV50: number;
  techniqueId: string;
  /** numero de cuerpos de este tipo; si algun grupo lo declara, la suma debe ser totalCorpseCount */
  count?: number;
}

/** criatura tal como llega del escenario: tipos y estadisticas se toman de la especie si se omiten */
export type BondedCreatureInput = Omit<BondedCreature, 'types' | 'baseStatsNV50' | 'horde'> & {
  types?: TypeId[];
  baseStatsNV50?: StatBlock;
  horde?: (Omit<HordeCorpse, 'atkNV50'> & { atkNV50?: number })[];
};

export interface Preparation<C = BondedCreature> {
  creatures: C[];
}

export interface SideSetup<C = BondedCreature> {
  summoner: Summoner;
  preparation: Preparation<C>;
  /** Vinculos no preparados, solo para comprobar 2.5 */
  otherBonds?: C[];
  /** ids de criaturas preparadas para las posiciones iniciales; null deja la posicion vacia */
  initialDeployment: (string | null)[];
}

export type SideSetupInput = SideSetup<BondedCreatureInput>;
