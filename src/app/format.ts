import type { GameData } from '../data/schema.js';
import type { BattleState, Combatant } from '../engine/model/battle.js';
import type { BattleEvent } from '../engine/log/events.js';
import { allCombatants } from '../engine/pipeline/context.js';

export function creatureName(st: BattleState, uid: string | undefined): string {
  if (!uid) return '?';
  const c = allCombatants(st).find((x) => x.uid === uid);
  return c ? `${c.displayName} (${st.sides[c.side].summoner.name})` : uid;
}

export function techName(data: GameData, id: unknown): string {
  return data.techniques.get(String(id))?.name ?? String(id);
}

const STAT_LABELS: Record<string, string> = { atk: 'Ataque', matk: 'Ataque magico', def: 'Defensa', mdef: 'Defensa magica', spe: 'Velocidad' };

const RESTRICTION_LABELS: Record<string, string> = {
  no_voluntary_withdraw: 'no puede retirarse',
  stat_cannot_increase: 'no puede subir',
  no_same_technique_consecutive: 'no puede repetir tecnica',
  dual_type_benefits_halved: 'beneficios duales a la mitad',
  manifestations_disabled: 'Manifestaciones desactivadas',
  bond_communication_cut: 'comunicacion cortada',
};

export function statusLine(c: Combatant, data?: GameData): string {
  const sts = c.statuses.map((s) => {
    const def = data?.statuses.get(s.id);
    const penalties = Object.entries(def?.statModifiersPct ?? {}).map(([k, v]) => `${k} ${v}%`);
    const active = Object.entries(s.counters).filter(([, v]) => v > 0).map(([k, v]) => `${RESTRICTION_LABELS[k] ?? k}: ${v} turno${v === 1 ? '' : 's'}`);
    const parts = [...penalties, ...active];
    return parts.length ? `${s.id}(${parts.join('; ')})` : s.id;
  });
  const stages = Object.entries(c.stages).filter(([, v]) => v !== 0).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
  const extra = [...sts, ...stages];
  return `${c.hp}/${c.maxHp}${extra.length ? ` [${extra.join(' ')}]` : ''}${c.charging ? ' (cargando)' : ''}`;
}

const ENVIRONMENT_LABELS: Record<string, string> = { weather: 'Clima', field: 'Campo', anomaly: 'Anomalia' };

function effectName(data: GameData, id: string): string {
  return data.techniques.get(id)?.name ?? data.manifestations.get(id)?.name ?? id;
}

function roundsLeft(n: number): string {
  if (n >= Number.MAX_SAFE_INTEGER / 2) return 'hasta consumirse';
  return `queda${n === 1 ? '' : 'n'} ${n} ronda${n === 1 ? '' : 's'}`;
}

export function activeEffectLines(data: GameData, st: BattleState, side: 0 | 1): string[] {
  const lines: string[] = [];
  const env = st.environment;
  if (env) lines.push(`${ENVIRONMENT_LABELS[env.kind] ?? env.kind}: ${effectName(data, env.id)}${env.sourceUid ? ` (de ${creatureName(st, env.sourceUid)})` : ''}`);
  for (const s of [side === 0 ? 1 : 0, side] as const) {
    const effs = st.sides[s].sideEffects.map((e) => `${effectName(data, e.id)}${e.barrier ? ' [barrera]' : ''} (${roundsLeft(e.roundsLeft)})`);
    if (effs.length) lines.push(`${s === side ? 'Tu lado' : 'Lado rival'}: ${effs.join(' | ')}`);
  }
  const f = st.field;
  if (f.trickRoomRounds > 0) lines.push(`Velocidad invertida (${roundsLeft(f.trickRoomRounds)})`);
  if (f.priorityNullifiedRound === st.round) lines.push('Anular prioridad (esta ronda)');
  if (f.revelationRounds > 0) lines.push(`Revelacion absoluta (${roundsLeft(f.revelationRounds)})`);
  return lines;
}

export function formatEvent(data: GameData, st: BattleState, e: BattleEvent): string | null {
  const who = creatureName(st, e.actor);
  const tgt = creatureName(st, e.targets?.[0]);
  const d = e.data ?? {};
  switch (e.type) {
    case 'battle_start': return `Combate (semilla ${String(d.seed)}, modo ${String((d.config as { effectsMode?: string })?.effectsMode)}, constante de dano ${String((d.config as { damageConstant?: number })?.damageConstant)}). Supuestos activos: ${(d.assumptions as unknown[]).length} (ver "cli gaps")`;
    case 'round_start': return `\n=== Ronda ${e.round} ===`;
    case 'materialize': return `${who} se materializa en ${e.targets?.[0]}`;
    case 'manifestation_inert': return `  Manifestacion ${String(d.manifestation)} de ${who}: sin efecto (${String(d.reason)})`;
    case 'deployment_complete': return 'Despliegue inicial completo';
    case 'declaration': return null;
    case 'switch': return `${who} se retira; entra ${creatureName(st, String(d.incoming))}`;
    case 'exit': return d.chargeLost ? `  ${who} pierde la carga al salir` : null;
    case 'entry_complete': return null;
    case 'dodge_success': return `${who} esquiva (uso ${String(d.consecutiveUse)}, ${String(d.chance)}%): exito`;
    case 'dodge_fail': return `${who} intenta esquivar (uso ${String(d.consecutiveUse)}, ${String(d.chance)}%): fallo`;
    case 'action_order': return d.reordered ? `  (cambia el orden: ${(d.order as string[]).map((u) => creatureName(st, u)).join(' > ')})` : null;
    case 'technique': return `${who} usa ${techName(data, d.technique)}`;
    case 'partial_materialization': return `${who} se materializa parcialmente en ${e.targets?.[0]} para usar ${techName(data, d.technique)}`;
    case 'partial_end': return `  ${who} vuelve al Intermedio`;
    case 'charge_start': return `${who} carga ${techName(data, d.technique)}`;
    case 'hit_count': return d.minimumFrom ? `  ${String(d.hits)} impactos (minimo por ${String(d.minimumFrom)})` : `  ${String(d.hits)} impactos`;
    case 'damage': {
      const mods = (d.modifiers as { pct: number; source: string }[] | undefined) ?? [];
      const m = mods.length ? ` [${mods.map((x) => `${x.source} ${x.pct > 0 ? '+' : ''}${x.pct}%`).join(', ')}]` : '';
      const stat = (label: string, p: { stat: string; stage: number; mods: { pct: number; source: string }[] } | null | undefined) => {
        if (!p || (p.stage === 0 && p.mods.length === 0)) return '';
        const parts = [...(p.stage !== 0 ? [`etapa ${p.stage > 0 ? '+' : ''}${p.stage}`] : []), ...p.mods.map((x) => `${x.source} ${x.pct > 0 ? '+' : ''}${x.pct}%`)];
        return ` {${label} ${STAT_LABELS[p.stat] ?? p.stat}: ${parts.join(', ')}}`;
      };
      const stats = stat('usa', d.attackParts as never) + stat('rival', d.ignoreDefense ? null : (d.defenseParts as never));
      return `  -> ${tgt} pierde ${String(d.loss)} (${String(d.before)} -> ${String(d.after)})${d.typeMult !== 1 ? ` x${String(d.typeMult)}` : ''}${m}${stats}`;
    }
    case 'manifestation': return `  Manifestacion ${String(d.manifestation)} de ${who}`;
    case 'manifestation_inactive': return `  Manifestacion ${String(d.manifestation)} de ${who} desactivada (${String(d.reason)})`;
    case 'status_applied': return `  ${tgt} queda ${String(d.status)} (${String(d.source)})`;
    case 'status_immune': return `  ${tgt} es inmune a ${String(d.status)}`;
    case 'status_already_present': return `  ${tgt} ya estaba ${String(d.status)}`;
    case 'status_not_applied': return `  ${String(d.status)} no se aplica a ${tgt} (${String(d.chance)}%)`;
    case 'environment_set': return `  ${String(d.environment)} se impone${d.replaced ? ` y sustituye a ${String(d.replaced)}` : ''}`;
    case 'flinch': return `  ${tgt} retrocede: no podra actuar este turno`;
    case 'flinch_no_effect': return `  ${tgt} no retrocede (${String(d.reason)})`;
    case 'technique_failed': return `  la tecnica falla: no se cumple su condicion de uso (${String(d.source)})`;
    case 'bonus_consumed': return `  ${String(d.manifestation)} potencia esta tecnica (+${String(d.pct)}%)`;
    case 'impact': return `  -> impacta a ${tgt}`;
    case 'stage': return d.reverted ? `  ${tgt}: ${String(d.stat)} vuelve a ${String(d.to)}` : `  ${tgt}: ${String(d.stat)} ${String(d.from)} -> ${String(d.to)}${d.stolen ? ' (robada)' : ''}`;
    case 'stage_blocked': return `  ${tgt}: ${String(d.stat)} no puede subir (${String(d.status)})`;
    case 'heal': return `  ${tgt} recupera ${String(d.healed)} (${String(d.before)} -> ${String(d.after)})${d.factor !== 1 ? ` x${Number(d.factor).toFixed(2)}` : ''}`;
    case 'recoil': return `  ${tgt} sufre retroceso: -${String(d.loss)} (${String(d.before)} -> ${String(d.after)})`;
    case 'self_damage': case 'periodic_damage': case 'death_mark_damage': case 'retaliation_damage': case 'reflect': case 'splash_damage':
    case 'shared_damage': case 'environment_damage':
      return `  ${tgt} pierde ${String(d.loss)} por ${String(d.source)} (${String(d.before)} -> ${String(d.after)})`;
    case 'survived': return `  ${tgt} resiste con ${String(d.hp)} de Vitalidad (${String(d.source)})`;
    case 'horde_corpse': return `  cadaver ${Number(d.hitIndex) + 1}: ${String(d.species)} usa ${techName(data, d.technique)} (Ataque ${String(d.attack)})`;
    case 'stage_inverted': return `  ${tgt}: el cambio de ${String(d.stat)} se invierte (${String(d.source)})`;
    case 'retaliation': return `  ${who} castiga el contacto de ${tgt} (${String(d.source)})`;
    case 'mark': return `  ${tgt}: ${String(d.source)} (${String(d.kind)})`;
    case 'mark_expired': case 'mark_consumed': return null;
    case 'mark_blocked': return `  ${tgt}: ${String(d.source)} no tiene efecto (${String(d.reason)})`;
    case 'marks_removed': return `  ${tgt} pierde ${String(d.removed)} efecto(s) (${String(d.source)})`;
    case 'side_effect_added': return `  ${String(d.id)} se establece en el lado ${String(d.side)} (${typeof d.rounds === 'number' ? `${d.rounds} rondas` : String(d.rounds)})`;
    case 'side_effect_destroyed': return d.consumed ? `  ${String(d.id)} se consume` : `  ${String(d.id)} es destruida (${String(d.source)})`;
    case 'side_effect_expired': return `${String(d.id)} se disipa en el lado ${String(d.side)}`;
    case 'field_flag': return `  ${String(d.source)}: ${String(d.flag)}${d.rounds ? ` (${String(d.rounds)} rondas)` : ''}`;
    case 'field_flag_expired': return `${String(d.flag)} termina`;
    case 'self_switch': return `  ${who} es sustituido por ${creatureName(st, String(d.incoming))} (${String(d.source)})`;
    case 'self_switch_failed': return `  ${who} no puede ser sustituido (${String(d.reason)})`;
    case 'self_switch_declined': return `  ${who} se queda en el campo`;
    case 'periodic': return null;
    case 'death_mark': return `  ${tgt} sucumbe a ${String(d.source)}`;
    case 'redirected': return `  el ataque se desvia hacia ${tgt}`;
    case 'intercept': return `${who} intercepta a ${tgt} antes de su retirada`;
    case 'status_cured': return `  ${tgt} se libra de ${String(d.status)}`;
    case 'effect_not_triggered': return null;
    case 'environment_cleared': return `  ${String(d.environment)} desaparece (${String(d.source)})`;
    case 'miss': return `  -> falla contra ${tgt} (precision ${Number(d.accuracy).toFixed(1)}%)`;
    case 'dodged': return `  -> ${tgt} lo esquiva`;
    case 'hit_no_target': return `  -> ${e.targets?.[0]} esta vacia: el impacto se pierde`;
    case 'retargeted': return `  -> ${String(d.from)} esta vacia: el ataque va contra ${tgt}`;
    case 'technique_no_effect': return `  -> ${techName(data, d.technique)} no tiene efecto ejecutable`;
    case 'technique_end': return null;
    case 'defeat': return `  ${who} es derrotado`;
    case 'forced_replacement': return `  ${who} entra en ${e.targets?.[0]} (Reemplazo forzado)`;
    case 'no_replacement': return `  ${e.targets?.[0]} queda vacia: no hay reservas`;
    case 'action_failed': return `${who}: la accion falla (${String(d.reason)})`;
    case 'status_damage': return `${who} pierde ${String(d.loss)} por ${String(d.status)} (${String(d.before)} -> ${String(d.after)})`;
    case 'position_opened': return `Se abre la posicion temporal ${e.targets?.[0]}`;
    case 'position_closed': return `La posicion temporal ${e.targets?.[0]} no se sostiene y desaparece`;
    case 'position_sustained': return `La posicion temporal ${e.targets?.[0]} se sostiene`;
    case 'tie_break': return `  (empate exacto resuelto al azar: ${(d.order as string[]).map((u) => creatureName(st, u.split('/')[0])).join(' > ')})`;
    case 'end_of_round': case 'counters_advanced': return null;
    case 'rule_gap': return `  (supuesto ${String(d.gap)}${e.targets?.length ? ` en ${e.targets.join(', ')}` : ''})`;
    case 'warning': return `  aviso: ${String(d.message)}`;
    case 'battle_end': return `\nFin: ${JSON.stringify(d.outcome)}`;
    default: return `[${e.type}] ${who} ${JSON.stringify(d)}`;
  }
}
