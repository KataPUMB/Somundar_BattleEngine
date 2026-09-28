import type { GameData } from '../data/schema.js';
import type { BattleState, Combatant } from '../engine/model/battle.js';
import type { BattleEvent } from '../engine/log/events.js';
import { allCombatants } from '../engine/pipeline/context.js';

export function creatureName(st: BattleState, uid: string | undefined): string {
  if (!uid) return '?';
  const c = allCombatants(st).find((x) => x.uid === uid);
  return c ? `${c.creature.name ?? c.creature.id} (${st.sides[c.side].summoner.name})` : uid;
}

export function techName(data: GameData, id: unknown): string {
  return data.techniques.get(String(id))?.name ?? String(id);
}

export function statusLine(c: Combatant): string {
  const sts = c.statuses.map((s) => {
    const counters = Object.entries(s.counters).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`);
    return counters.length ? `${s.id}(${counters.join(',')})` : s.id;
  });
  const stages = Object.entries(c.stages).filter(([, v]) => v !== 0).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
  const extra = [...sts, ...stages];
  return `${c.hp}/${c.maxHp}${extra.length ? ` [${extra.join(' ')}]` : ''}${c.charging ? ' (cargando)' : ''}`;
}

export function formatEvent(data: GameData, st: BattleState, e: BattleEvent): string | null {
  const who = creatureName(st, e.actor);
  const tgt = creatureName(st, e.targets?.[0]);
  const d = e.data ?? {};
  switch (e.type) {
    case 'battle_start': return `Combate (semilla ${String(d.seed)}, modo ${String((d.config as { effectsMode?: string })?.effectsMode)}). Supuestos activos: ${(d.assumptions as unknown[]).length} (ver "cli gaps")`;
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
    case 'action_order': return null;
    case 'technique': return `${who} usa ${techName(data, d.technique)}`;
    case 'partial_materialization': return `${who} se materializa parcialmente en ${e.targets?.[0]} para usar ${techName(data, d.technique)}`;
    case 'partial_end': return `  ${who} vuelve al Intermedio`;
    case 'charge_start': return `${who} carga ${techName(data, d.technique)}`;
    case 'hit_count': return `  ${String(d.hits)} impactos`;
    case 'damage': return `  -> ${tgt} pierde ${String(d.loss)} (${String(d.before)} -> ${String(d.after)})${d.typeMult !== 1 ? ` x${String(d.typeMult)}` : ''}`;
    case 'miss': return `  -> falla contra ${tgt} (precision ${Number(d.accuracy).toFixed(1)}%)`;
    case 'dodged': return `  -> ${tgt} lo esquiva`;
    case 'hit_no_target': return `  -> ${e.targets?.[0]} esta vacia: el impacto se pierde`;
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
