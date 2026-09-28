import type { Manifestation, Technique } from '../../data/schema.js';
import type { OpKind } from './dsl.js';

export type EffectsMode = 'strict' | 'lenient';

export const SUPPORTED_OPS: ReadonlySet<OpKind> = new Set<OpKind>([
  'modifyDamage', 'modifyAccuracy', 'applyStatus', 'setEnvironment', 'flinch', 'failTechnique', 'disableManifestations',
  'modifyHealing', 'heal', 'stage', 'clearStages', 'cureStatuses', 'stealStage', 'stageHighest', 'convertStages',
  'selfDamage', 'recoil', 'drain', 'distributeHeal', 'selfSwitch', 'mark', 'addSideEffect', 'destroySideEffect',
  'setFieldFlag', 'clearEnvironment', 'lockTechnique', 'ignoreDefense', 'attackStat', 'typeOverride', 'ignoreBarriers',
  'modifyPriority', 'removeMarks', 'consumeMark', 'modifyStat',
  'commitFirstTechnique', 'minHits', 'invertStages', 'capManifestationDamage', 'ignoreEnvironmentDamage', 'shareDamage',
  'extendBarriers', 'typedLoss', 'survivesAt1Hp', 'divideDamage',
]);
export const SUPPORTED_HANDLERS: ReadonlySet<string> = new Set<string>(['horda']);

export type CoverageStatus = 'implemented' | 'base_only_verified' | 'curated_pending' | 'uncurated' | 'needs_handler';

export interface Availability {
  status: CoverageStatus;
  executable: boolean;
  baseOnly: boolean;
  reason?: string;
}

function numericParams(t: Technique): boolean {
  if (t.class === 'status') return true;
  return typeof t.power?.perHit === 'number' && !!t.power.hits;
}

function numericAccuracy(t: Technique): boolean {
  return typeof t.accuracy === 'number' || t.override?.neverMiss === true || t.override?.accuracyAssumed !== undefined;
}

export function techniqueAvailability(t: Technique, mode: EffectsMode): Availability {
  const ov = t.override;
  if (ov?.handler) {
    return SUPPORTED_HANDLERS.has(ov.handler)
      ? { status: 'implemented', executable: true, baseOnly: false }
      : { status: 'needs_handler', executable: false, baseOnly: false, reason: `handler ${ov.handler} no implementado` };
  }
  if (!numericParams(t) || !numericAccuracy(t)) {
    return { status: 'needs_handler', executable: false, baseOnly: false, reason: 'parametros no numericos (poder o precision)' };
  }
  if (ov?.effects) {
    if (ov.effects.length === 0) return { status: 'base_only_verified', executable: true, baseOnly: true };
    const missing = ov.effects.flatMap((e) => e.ops).filter((o) => !SUPPORTED_OPS.has(o.op));
    if (missing.length === 0) return { status: 'implemented', executable: true, baseOnly: false };
    const ops = [...new Set(missing.map((o) => o.op))].join(', ');
    return { status: 'curated_pending', executable: false, baseOnly: false, reason: `operaciones sin interprete: ${ops}` };
  }
  if (mode === 'lenient') {
    return { status: 'uncurated', executable: true, baseOnly: true, reason: 'sin efectos curados: solo parametros base (lenient)' };
  }
  return { status: 'uncurated', executable: false, baseOnly: false, reason: 'sin efectos curados (modo strict)' };
}

export function manifestationAvailability(m: Manifestation): Availability {
  const ov = m.override;
  if (ov?.handler) {
    return SUPPORTED_HANDLERS.has(ov.handler)
      ? { status: 'implemented', executable: true, baseOnly: false }
      : { status: 'needs_handler', executable: false, baseOnly: false, reason: `handler ${ov.handler} no implementado` };
  }
  if (!ov?.effects) return { status: 'uncurated', executable: false, baseOnly: false, reason: 'sin efectos curados' };
  const missing = ov.effects.flatMap((e) => e.ops).filter((o) => !SUPPORTED_OPS.has(o.op));
  if (missing.length === 0) return { status: 'implemented', executable: true, baseOnly: false };
  const ops = [...new Set(missing.map((o) => o.op))].join(', ');
  return { status: 'curated_pending', executable: false, baseOnly: false, reason: `operaciones sin interprete: ${ops}` };
}
