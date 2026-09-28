export const TRIGGERS = [
  'on_use', 'on_hit', 'after_damage', 'on_entry', 'on_exit', 'on_voluntary_withdraw', 'on_switched_out',
  'on_damage_taken', 'on_hp_threshold', 'would_be_defeated', 'on_stat_lowered', 'on_status_applied',
  'on_enemy_voluntary_withdraw', 'end_of_turn', 'end_of_round', 'passive', 'environment',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const EFFECT_TARGETS = ['self', 'target', 'all_enemies', 'all_allies', 'all_present', 'position'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const OP_KINDS = [
  'damage', 'heal', 'applyStatus', 'stage', 'clearStages', 'cureStatuses', 'modifyDamage', 'divideDamage',
  'modifyStat', 'modifyAccuracy', 'modifyPriority', 'forceSwitch', 'selfSwitch', 'preventWithdraw',
  'setEnvironment', 'addSideEffect', 'destroySideEffect', 'mark', 'lockTechnique', 'survivesAt1Hp',
  'redirectAttacks', 'ignoreResistances', 'ignoreDefense', 'recoil', 'drain', 'handler',
  'flinch', 'failTechnique', 'disableManifestations', 'modifyHealing',
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
  targetHpBelowPct?: number;
  targetHasNotActed?: boolean;
  userFirstTurnSinceEntry?: boolean;
}

export const CONDITION_KEYS: readonly (keyof Condition)[] = [
  'techniqueType', 'techniqueClass', 'subjectTypes', 'subjectNotTypes', 'targetHasAnyStatus', 'targetHpBelowPct',
  'targetHasNotActed', 'userFirstTurnSinceEntry',
];

export interface Effect {
  trigger: Trigger;
  condition?: Condition;
  target: EffectTarget;
  ops: Op[];
  duration?: { turns?: number; rounds?: number; untilExit?: boolean; untilNextAction?: boolean };
  flags?: { worksWhileDesvinculado?: boolean; isSecondaryEffect?: boolean; perHit?: boolean };
  ruleRef?: string;
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
    });
    if (eff.condition !== undefined) {
      if (typeof eff.condition !== 'object' || eff.condition === null) errors.push(`${at}: condition debe ser un objeto`);
      else for (const k of Object.keys(eff.condition)) if (!CONDITION_KEYS.includes(k as keyof Condition)) errors.push(`${at}: condicion desconocida ${k}`);
    }
  });
  return errors;
}
