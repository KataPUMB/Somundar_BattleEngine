export const TRIGGERS = [
  'on_use', 'on_hit', 'after_damage', 'after_use', 'on_entry', 'on_exit', 'on_voluntary_withdraw', 'on_switched_out',
  'on_damage_taken', 'on_hp_threshold', 'would_be_defeated', 'on_stat_lowered', 'on_status_applied',
  'on_enemy_voluntary_withdraw', 'end_of_turn', 'end_of_round', 'passive', 'environment', 'on_technique_received',
  'environment_entry',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const EFFECT_TARGETS = ['self', 'target', 'all_enemies', 'all_allies', 'other_allies', 'all_present', 'position', 'lowest_ally'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const OP_KINDS = [
  'damage', 'heal', 'applyStatus', 'stage', 'clearStages', 'cureStatuses', 'modifyDamage', 'divideDamage',
  'modifyStat', 'modifyAccuracy', 'modifyPriority', 'forceSwitch', 'selfSwitch', 'preventWithdraw',
  'setEnvironment', 'addSideEffect', 'destroySideEffect', 'mark', 'lockTechnique', 'survivesAt1Hp',
  'redirectAttacks', 'ignoreResistances', 'ignoreDefense', 'recoil', 'drain', 'handler',
  'flinch', 'failTechnique', 'disableManifestations', 'modifyHealing',
  'stealStage', 'stageHighest', 'convertStages', 'selfDamage', 'distributeHeal', 'attackStat', 'typeOverride',
  'ignoreBarriers', 'setFieldFlag', 'clearEnvironment', 'removeMarks', 'consumeMark',
  'commitFirstTechnique', 'minHits', 'invertStages', 'capManifestationDamage', 'ignoreEnvironmentDamage', 'shareDamage',
  'extendBarriers', 'typedLoss',
] as const;
export type OpKind = (typeof OP_KINDS)[number];

export interface Op {
  op: OpKind;
  [param: string]: unknown;
}

export interface Condition {
  techniqueType?: string[];
  techniqueClass?: ('physical' | 'magical' | 'status')[];
  subjectTypes?: string[];
  subjectNotTypes?: string[];
  targetHasAnyStatus?: boolean;
  targetHasStatus?: string[];
  targetHpBelowPct?: number;
  targetHasNotActed?: boolean;
  targetHasPositiveStage?: boolean;
  targetHasNegativeStage?: boolean;
  targetMissedLastDamaging?: boolean;
  targetDeclaredStatusTechnique?: boolean;
  targetHasMark?: string;
  userHasMark?: string;
  userFirstTurnSinceEntry?: boolean;
  userHpBelowPct?: number;
  userHpAtLeastPct?: number;
  userDamagedThisRound?: boolean;
  userDealtDamageLastRound?: boolean;
  environmentIs?: string[];
  environmentIsNot?: string[];
  choice?: string;
  minHitsOnTarget?: number;
  techniquePhase?: number;
  subjectHasStatus?: string[];
  subjectCharging?: boolean;
  subjectCanTransfigure?: boolean;
  techniqueCategory?: string[];
  techniqueTypeNotOwn?: boolean;
  techniqueHasAdditionalEffects?: boolean;
  techniqueFirstUseEver?: boolean;
  techniqueCharged?: boolean;
  userUsedAllTechniques?: boolean;
  userEquipMaxCostAtMost?: number;
  userEquipCostAtLeast?: { cost: number; count: number };
  hpCrossedBelowPct?: number;
  subjectHpFull?: boolean;
}

export const CONDITION_KEYS: readonly (keyof Condition)[] = [
  'techniqueType', 'techniqueClass', 'subjectTypes', 'subjectNotTypes', 'targetHasAnyStatus', 'targetHasStatus',
  'targetHpBelowPct', 'targetHasNotActed', 'targetHasPositiveStage', 'targetHasNegativeStage', 'targetMissedLastDamaging',
  'targetDeclaredStatusTechnique', 'targetHasMark', 'userHasMark', 'userFirstTurnSinceEntry', 'userHpBelowPct',
  'userHpAtLeastPct', 'userDamagedThisRound', 'userDealtDamageLastRound', 'environmentIs', 'environmentIsNot', 'choice', 'minHitsOnTarget',
  'techniquePhase', 'subjectHasStatus', 'subjectCharging', 'subjectCanTransfigure', 'techniqueCategory', 'techniqueTypeNotOwn',
  'techniqueHasAdditionalEffects', 'techniqueFirstUseEver', 'techniqueCharged', 'userUsedAllTechniques', 'userEquipMaxCostAtMost',
  'userEquipCostAtLeast', 'hpCrossedBelowPct', 'subjectHpFull',
];

export interface Effect {
  trigger: Trigger;
  condition?: Condition;
  targetFilter?: Condition;
  target: EffectTarget;
  ops: Op[];
  duration?: { turns?: number; rounds?: number; untilExit?: boolean; untilNextAction?: boolean };
  flags?: { worksWhileDesvinculado?: boolean; isSecondaryEffect?: boolean; perHit?: boolean; oncePerBattle?: boolean };
  ruleRef?: string;
}

const STATUS = ['quemado', 'saturado', 'enraizado', 'agrietado', 'paralizado', 'desorientado', 'espiritu_cercenado', 'desvinculado'];
const STAGES = ['atk', 'matk', 'def', 'mdef', 'spe', 'accuracy', '$instinct'];
const MARK_KINDS = [
  'healing_mod', 'incoming_accuracy', 'outgoing_accuracy', 'damage_taken', 'retaliate_contact', 'redirect', 'no_withdraw', 'periodic',
  'death', 'next_damage_bonus', 'sure_hit', 'undermine', 'stored_energy', 'priority_mod', 'temp_stage', 'reactive', 'type_lock',
  'technique_lock', 'tag',
];

function validateOpParams(o: Record<string, unknown>, at: string): string[] {
  const errors: string[] = [];
  if (o.op === 'applyStatus' && !STATUS.includes(String(o.status))) errors.push(`${at}: estado desconocido ${String(o.status)}`);
  if (o.op === 'stage') {
    const stats = (o.stats as string[] | undefined) ?? [String(o.stat)];
    for (const s of stats) if (!STAGES.includes(s)) errors.push(`${at}: estadistica desconocida ${s}`);
    if (typeof o.n !== 'number') errors.push(`${at}: stage requiere n numerico`);
  }
  if (o.op === 'mark') {
    if (!MARK_KINDS.includes(String(o.kind))) errors.push(`${at}: tipo de marca desconocido ${String(o.kind)}`);
    for (const k of ['onHit', 'onSurvive', 'ops']) {
      const nested = o[k];
      if (Array.isArray(nested)) nested.forEach((n, i) => errors.push(...validateOpParams(n as Record<string, unknown>, `${at}.${k}[${i}]`)));
    }
  }
  if (o.op === 'cureStatuses' && o.ids) for (const s of o.ids as string[]) if (!STATUS.includes(s)) errors.push(`${at}: estado desconocido ${s}`);
  return errors;
}

export function validateEffects(effects: unknown, where: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(effects)) return [`${where}: effects debe ser un array`];
  effects.forEach((e: unknown, i) => {
    const at = `${where}.effects[${i}]`;
    if (typeof e !== 'object' || e === null) {
      errors.push(`${at}: debe ser un objeto`);
      return;
    }
    const eff = e as Record<string, unknown>;
    if (!TRIGGERS.includes(eff.trigger as Trigger)) errors.push(`${at}: trigger desconocido ${String(eff.trigger)}`);
    if (!EFFECT_TARGETS.includes(eff.target as EffectTarget)) errors.push(`${at}: target desconocido ${String(eff.target)}`);
    if (!Array.isArray(eff.ops) || eff.ops.length === 0) {
      errors.push(`${at}: ops debe ser un array no vacio`);
      return;
    }
    eff.ops.forEach((o: unknown, j) => {
      const op = (o as Record<string, unknown> | null)?.op;
      if (!OP_KINDS.includes(op as OpKind)) errors.push(`${at}.ops[${j}]: op desconocida ${String(op)}`);
      errors.push(...validateOpParams(o as Record<string, unknown>, `${at}.ops[${j}]`));
    });
    for (const key of ['condition', 'targetFilter'] as const) {
      const cond = eff[key];
      if (cond === undefined) continue;
      if (typeof cond !== 'object' || cond === null) errors.push(`${at}: ${key} debe ser un objeto`);
      else for (const k of Object.keys(cond)) if (!CONDITION_KEYS.includes(k as keyof Condition)) errors.push(`${at}: condicion desconocida ${k}`);
    }
  });
  return errors;
}
