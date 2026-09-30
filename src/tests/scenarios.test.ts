import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beginRound, createBattle, resolveRound } from '../engine/pipeline/battle.js';
import { combatant, type Controllers, type EngineCtx } from '../engine/pipeline/context.js';
import { effStat } from '../engine/pipeline/combatant.js';
import { statOf } from '../engine/effects/runtime.js';
import { validatePreparation } from '../engine/legality/preparation.js';
import { runBattle } from '../app/simulate.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import type { Action, BattleState, Declarations } from '../engine/model/battle.js';
import type { BondedCreature, SideSetup } from '../engine/model/types.js';
import { DATA_DIR, creature, eventsOf, loadData, summoner, uid } from './helpers.js';

const data = loadData();
const SCENARIOS = ['sarah_vs_adriano.json', 'asesino_vs_adriano.json'];
const load = (f: string) => JSON.parse(readFileSync(resolve(DATA_DIR, '../scenarios', f), 'utf8')) as { sides: SideSetup[] };
const noOtherBonds = (s: SideSetup): SideSetup => ({ summoner: s.summoner, preparation: s.preparation, initialDeployment: s.initialDeployment });

interface Duel {
  file: string;
  id: string;
  ally?: string;
  hp?: Record<string, number>;
  dummy?: Partial<BondedCreature>;
  rounds: ((round: number) => Declarations)[];
  controllers?: Controllers;
}

const DUMMY_TECHS = ['enfado', 'acelerar', 'zarpazo', 'rafaga'];
const dummyAction = (r: number): Action => ({ kind: 'technique', techniqueId: r % 2 ? 'enfado' : 'acelerar', target: { kind: 'auto' } });

function duel(d: Duel): BattleState {
  const scen = load(d.file);
  const own = scen.sides.find((s) => s.preparation.creatures.some((c) => c.id === d.id))!;
  const creatures = structuredClone(own.preparation.creatures).map((c) => (d.hp?.[c.id] !== undefined ? { ...c, hpCurrent: d.hp[c.id] } : c));
  const a: SideSetup = { summoner: own.summoner, preparation: { creatures }, initialDeployment: d.ally ? [d.id, d.ally] : [d.id] };
  const dummy = creature('dummy', {
    speciesId: 'prueba', types: ['tierra'], baseStatsNV50: { hp: 5000, atk: 100, matk: 100, def: 100, mdef: 100, spe: 10 },
    equippedTechniques: DUMMY_TECHS, ...d.dummy,
  });
  const b: SideSetup = { summoner: summoner('dummy', 'iniciado', { amplitude: null }), preparation: { creatures: [dummy] }, initialDeployment: ['dummy'] };
  let st = createBattle(data, [a, b], { seed: 1 });
  d.rounds.forEach((decl, i) => {
    if (st.outcome) return;
    st = resolveRound(data, beginRound(data, st), { S1P0: dummyAction(i + 1), ...decl(i + 1) }, d.controllers ?? {});
  });
  return st;
}

const use = (techniqueId: string, pos = 'S0P0'): Declarations => {
  const t = data.techniques.get(techniqueId)!;
  const auto = t.override?.targetSide === 'self' || t.override?.targetSide === 'side' || t.targeting === 'all';
  return { [pos]: { kind: 'technique', techniqueId, target: auto ? { kind: 'auto' } : { kind: 'position', positionId: 'S1P0' } } };
};
const ctxOf = (st: BattleState): EngineCtx => ({ data, st, controllers: {} });
const D = uid(1, 'dummy');
const byTech = (st: BattleState, id: string) => eventsOf(st, 'damage').filter((e) => e.data!.technique === id);
const mods = (e: { data?: Record<string, unknown> }) => (e.data!.modifiers as { source: string; pct: number }[]).map((m) => `${m.source}:${m.pct}`);

test('escenarios: Preparaciones validas y 40 combates aleatorios por escenario sin errores', () => {
  for (const f of SCENARIOS) {
    const scen = load(f);
    for (const s of scen.sides) assert.deepEqual(validatePreparation(noOtherBonds(s), data).filter((v) => v.severity === 'error'), [], f);
    for (let seed = 1; seed <= 40; seed++) {
      const st = runBattle(data, [noOtherBonds(scen.sides[0]!), noOtherBonds(scen.sides[1]!)], [randomLegalPolicy, randomLegalPolicy], { seed, config: { maxRounds: 30 } });
      assert.ok(st.outcome, `${f} semilla ${seed}`);
      assert.equal(eventsOf(st, 'manifestation_inert').length, 0);
      assert.equal(eventsOf(st, 'warning').length, 0);
    }
  }
});

test('escenarios: toda tecnica de dano equipada impacta y causa dano', () => {
  for (const f of SCENARIOS) {
    for (const side of load(f).sides) {
      for (const c of side.preparation.creatures) {
        for (const tid of c.equippedTechniques) {
          const t = data.techniques.get(tid)!;
          if (t.class === 'status') continue;
          const st = duel({ file: f, id: c.id, rounds: [() => use(tid)] });
          const hit = byTech(st, tid)[0];
          assert.ok(hit && Number(hit.data!.loss) > 0, `${f} ${c.id} ${tid}`);
        }
      }
    }
  }
});

const cases: Record<string, Duel & { check: (st: BattleState) => void }> = {
  agua_curativa: { file: 'asesino_vs_adriano.json', id: 'nayara', hp: { nayara: 100 }, rounds: [() => use('agua_curativa')],
    check: (st) => {
      const h = eventsOf(st, 'heal').find((e) => e.data!.source === 'agua_curativa')!;
      assert.equal(h.data!.healed, Math.round(combatant(st, uid(0, 'nayara')).maxHp * 0.33));
    } },
  anular_impulso: { file: 'sarah_vs_adriano.json', id: 'luminax', rounds: [() => use('bala_de_plata'), () => use('anular_impulso')],
    check: (st) => {
      assert.ok(eventsOf(st, 'stage', 2).some((e) => e.data!.source === 'anular_impulso' && e.data!.stat === 'atk' && e.data!.to === 0));
    } },
  anular_prioridad: { file: 'asesino_vs_adriano.json', id: 'sedopan', rounds: [() => use('anular_prioridad')],
    check: (st) => assert.equal(eventsOf(st, 'field_flag')[0]!.data!.flag, 'priority_nullified') },
  apagon: { file: 'asesino_vs_adriano.json', id: 'bramentor', rounds: [() => use('apagon')],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'desvinculado')) },
  bala_de_plata: { file: 'sarah_vs_adriano.json', id: 'luminax', dummy: { types: ['luz'] }, rounds: [() => use('bala_de_plata')],
    check: (st) => assert.equal(byTech(st, 'bala_de_plata')[0]!.data!.typeMult, 2) },
  corrientes_cambiantes: { file: 'sarah_vs_adriano.json', id: 'brumarina', rounds: [() => use('corrientes_cambiantes')],
    check: (st) => assert.equal(combatant(st, uid(0, 'brumarina')).location, 'intermedio') },
  corte_de_vinculo: { file: 'asesino_vs_adriano.json', id: 'litofis', rounds: [() => use('corte_de_vinculo')],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'desvinculado')) },
  debilitar: { file: 'sarah_vs_adriano.json', id: 'velaflora', rounds: [() => use('debilitar')],
    check: (st) => assert.ok(eventsOf(st, 'stage').some((e) => e.data!.source === 'debilitar' && e.data!.stat === 'atk' && e.data!.delta === -1)) },
  descarga_de_presion: { file: 'sarah_vs_adriano.json', id: 'undaria', rounds: [() => use('descarga_de_presion')],
    check: (st) => assert.equal(combatant(st, uid(0, 'undaria')).location, 'intermedio') },
  desorientar: { file: 'asesino_vs_adriano.json', id: 'mota', rounds: [() => use('desorientar')],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'desorientado')) },
  estela: { file: 'asesino_vs_adriano.json', id: 'mota', rounds: [() => use('estela')],
    check: (st) => {
      const m = combatant(st, uid(0, 'mota'));
      assert.equal(st.sides[0].sideEffects[0]?.id, 'estela');
      assert.ok(Math.abs(statOf(ctxOf(st), m, 'spe') / effStat(data, m, 'spe') - 2) < 0.01);
    } },
  hoja_de_viento: { file: 'asesino_vs_adriano.json', id: 'brumarina', rounds: [() => use('hoja_de_viento')],
    check: (st) => assert.equal(byTech(st, 'hoja_de_viento')[0]!.data!.ignoreDefense, true) },
  impacto_acorazado: { file: 'asesino_vs_adriano.json', id: 'litofis', rounds: [() => use('impacto_acorazado')],
    check: (st) => assert.equal(byTech(st, 'impacto_acorazado')[0]!.data!.attack, effStat(data, combatant(st, uid(0, 'litofis')), 'def')) },
  licuar: { file: 'asesino_vs_adriano.json', id: 'nayara', rounds: [() => use('licuar')],
    check: (st) => {
      const n = combatant(st, uid(0, 'nayara'));
      assert.equal(n.stages.spe, 1);
      assert.ok(eventsOf(st, 'mark').some((e) => e.data!.kind === 'damage_taken' && e.data!.source === 'licuar'));
      assert.ok(!n.marks.some((m) => m.source === 'licuar'), 'dura solo la ronda');
    } },
  marana: { file: 'sarah_vs_adriano.json', id: 'velaflora', dummy: { equippedTechniques: ['estela', 'enfado', 'acelerar'] },
    rounds: [() => ({ ...use('debilitar'), S1P0: { kind: 'technique', techniqueId: 'estela', target: { kind: 'auto' } } }), () => use('marana')],
    check: (st) => assert.equal(eventsOf(st, 'side_effect_destroyed', 2)[0]!.data!.id, 'estela') },
  mordisco_de_presa: { file: 'asesino_vs_adriano.json', id: 'litofis', rounds: [() => use('mordisco_de_presa')],
    check: (st) => assert.ok(combatant(st, D).marks.some((m) => m.kind === 'no_withdraw')) },
  muralla_quebrada: { file: 'asesino_vs_adriano.json', id: 'litofis', rounds: [() => use('muralla_quebrada')],
    check: (st) => assert.ok(mods(byTech(st, 'muralla_quebrada')[0]!).includes('muralla_quebrada:50')) },
  prisma_de_retorno: { file: 'sarah_vs_adriano.json', id: 'luminax', rounds: [() => use('prisma_de_retorno')],
    check: (st) => assert.equal(byTech(st, 'prisma_de_retorno')[0]!.data!.attack, effStat(data, combatant(st, uid(0, 'luminax')), 'mdef')) },
  puno_preciso: { file: 'sarah_vs_adriano.json', id: 'undaria', rounds: [() => use('puno_preciso')],
    check: (st) => {
      assert.equal(eventsOf(st, 'flinch').length, 1);
      assert.ok(eventsOf(st, 'action_failed').some((e) => e.actor === D));
    } },
  rebufo: { file: 'sarah_vs_adriano.json', id: 'mota', rounds: [() => use('rebufo')], controllers: { chooseOptionalSwitch: (_s, _u, c) => c[0]! },
    check: (st) => {
      assert.equal(combatant(st, uid(0, 'mota')).location, 'intermedio');
      assert.equal(eventsOf(st, 'self_switch')[0]!.data!.mode, 'optional');
    } },
  salto_de_voltaje: { file: 'asesino_vs_adriano.json', id: 'bramentor', rounds: [() => use('salto_de_voltaje')],
    check: (st) => assert.equal(combatant(st, uid(0, 'bramentor')).location, 'intermedio') },
  saturar: { file: 'sarah_vs_adriano.json', id: 'undaria', rounds: [() => use('saturar')],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'saturado')) },
  silencio_de_alas: { file: 'asesino_vs_adriano.json', id: 'noctivelo',
    rounds: [() => ({ S0P0: { kind: 'dodge' }, S1P0: { kind: 'technique', techniqueId: 'zarpazo', target: { kind: 'position', positionId: 'S0P0' } } }), () => use('silencio_de_alas')],
    check: (st) => assert.ok(mods(byTech(st, 'silencio_de_alas')[0]!).includes('silencio_de_alas:75')) },
  tu_miedo: { file: 'asesino_vs_adriano.json', id: 'sedopan', dummy: { baseStatsNV50: { hp: 5000, atk: 90, matk: 140, def: 100, mdef: 100, spe: 10 } }, rounds: [() => use('tu_miedo')],
    check: (st) => assert.equal(combatant(st, D).stages.matk, -2) },
  velocidad_invertida: { file: 'sarah_vs_adriano.json', id: 'velaflora', rounds: [() => use('velocidad_invertida')],
    check: (st) => assert.equal(st.field.trickRoomRounds, 4) },
  // Manifestaciones
  mundano: { file: 'asesino_vs_adriano.json', id: 'risco', rounds: [() => use('ariete_draconico')],
    check: (st) => assert.ok(mods(byTech(st, 'ariete_draconico')[0]!).includes('mundano:100')) },
  ruptura_de_afinidad: { file: 'sarah_vs_adriano.json', id: 'risco', dummy: { types: ['agua'] }, rounds: [() => use('fauces_incandescentes')],
    check: (st) => assert.equal(byTech(st, 'fauces_incandescentes')[0]!.data!.typeMult, 1) },
  filo_del_viento: { file: 'sarah_vs_adriano.json', id: 'brumarina', rounds: [() => use('corrientes_cambiantes')],
    check: (st) => assert.ok(mods(byTech(st, 'corrientes_cambiantes')[0]!).includes('filo_del_viento:25')) },
  formacion_de_caza: { file: 'sarah_vs_adriano.json', id: 'mota', ally: 'brumarina', rounds: [],
    check: (st) => {
      const b = combatant(st, uid(0, 'brumarina'));
      assert.ok(Math.abs(statOf(ctxOf(st), b, 'matk') / effStat(data, b, 'matk') - 1.25) < 0.01);
    } },
  formacion_de_caza_en_el_log: { file: 'sarah_vs_adriano.json', id: 'mota', ally: 'brumarina', rounds: [() => ({ ...use('estela'), ...use('corrientes_cambiantes', 'S0P1') })],
    check: (st) => {
      const parts = byTech(st, 'corrientes_cambiantes')[0]!.data!.attackParts as { mods: { source: string; pct: number }[] };
      assert.ok(parts.mods.some((m) => m.source === 'formacion_de_caza' && m.pct === 25));
    } },
  oportunista: { file: 'sarah_vs_adriano.json', id: 'mota', dummy: { baseStatsNV50: { hp: 5000, atk: 100, matk: 100, def: 100, mdef: 100, spe: 400 } }, rounds: [() => use('estela')],
    check: (st) => assert.deepEqual(eventsOf(st, 'action_order')[0]!.data!.order, [uid(0, 'mota'), D]) },
  golpe_desorientador: { file: 'sarah_vs_adriano.json', id: 'velaflora', rounds: [],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'desorientado')) },
  fronda_guardiana: { file: 'sarah_vs_adriano.json', id: 'velaflora', rounds: [() => ({ ...use('debilitar'), S1P0: { kind: 'technique', techniqueId: 'zarpazo', target: { kind: 'position', positionId: 'S0P0' } } })],
    check: (st) => assert.ok(mods(byTech(st, 'zarpazo')[0]!).includes('fronda_guardiana:-25')) },
  cuerpo_fluido: { file: 'sarah_vs_adriano.json', id: 'undaria', rounds: [() => ({ ...use('saturar'), S1P0: { kind: 'technique', techniqueId: 'zarpazo', target: { kind: 'position', positionId: 'S0P0' } } })],
    check: (st) => assert.ok(mods(byTech(st, 'zarpazo')[0]!).includes('cuerpo_fluido:-25')) },
  contracorriente_verde: { file: 'sarah_vs_adriano.json', id: 'undaria', rounds: [() => use('forma_de_ola')],
    check: (st) => assert.ok(mods(byTech(st, 'forma_de_ola')[0]!).includes('contracorriente_verde:50')) },
  muralla_emergente: { file: 'sarah_vs_adriano.json', id: 'luminax', hp: { luminax: 100 }, rounds: [],
    check: (st) => {
      assert.equal(st.sides[0].sideEffects[0]?.id, 'muralla_emergente');
      assert.ok(eventsOf(st, 'heal').some((e) => e.data!.source === 'bendicion_de_llegada' && Number(e.data!.healed) > 0));
    } },
  marea_reparadora: { file: 'asesino_vs_adriano.json', id: 'nayara', hp: { nayara: 100 }, rounds: [],
    check: (st) => assert.ok(eventsOf(st, 'heal').some((e) => e.data!.source === 'marea_reparadora' && Number(e.data!.healed) > 0)) },
  ruptura_del_vinculo: { file: 'asesino_vs_adriano.json', id: 'sedopan', rounds: [],
    check: (st) => assert.ok(combatant(st, D).statuses.some((s) => s.id === 'desvinculado')) },
  hambre_del_abismo: { file: 'asesino_vs_adriano.json', id: 'sedopan', rounds: [() => use('punetazo')],
    check: (st) => {
      const loss = eventsOf(st, 'self_damage').find((e) => e.data!.source === 'hambre_del_abismo')!;
      assert.equal(loss.targets?.[0], D);
      assert.equal(loss.data!.loss, Math.round(combatant(st, D).maxHp * 0.0625));
    } },
  sed_carmesi: { file: 'asesino_vs_adriano.json', id: 'litofis', hp: { litofis: 50 }, rounds: [() => use('mordisco_de_presa')],
    check: (st) => {
      const dealt = Number(byTech(st, 'mordisco_de_presa')[0]!.data!.loss);
      assert.equal(eventsOf(st, 'heal').find((e) => e.data!.source === 'sed_carmesi')!.data!.healed, Math.round(dealt * 0.125));
    } },
  baluarte: { file: 'asesino_vs_adriano.json', id: 'litofis', rounds: [() => ({ ...use('impacto_acorazado'), S1P0: { kind: 'technique', techniqueId: 'zarpazo', target: { kind: 'position', positionId: 'S0P0' } } })],
    check: (st) => assert.ok(mods(byTech(st, 'zarpazo')[0]!).includes('baluarte:-25')) },
  noche_protectora: { file: 'asesino_vs_adriano.json', id: 'bramentor', dummy: { types: ['aire'] }, rounds: [() => ({ ...use('zarpazo'), S1P0: { kind: 'technique', techniqueId: 'rafaga', target: { kind: 'position', positionId: 'S0P0' } } })],
    check: (st) => assert.ok(mods(byTech(st, 'rafaga')[0]!).includes('noche_protectora:-25')) },
  reflejos_electricos: { file: 'asesino_vs_adriano.json', id: 'bramentor', rounds: [],
    check: (st) => {
      const b = combatant(st, uid(0, 'bramentor'));
      assert.ok(Math.abs(statOf(ctxOf(st), b, 'spe') / effStat(data, b, 'spe') - 1.25) < 0.01);
    } },
  reflujo_umbrio: { file: 'asesino_vs_adriano.json', id: 'noctivelo', ally: 'litofis', hp: { litofis: 100 },
    rounds: [() => ({ S0P0: { kind: 'switch', incomingId: 'bramentor' }, S0P1: use('impacto_acorazado', 'S0P1').S0P1! })],
    check: (st) => assert.ok(eventsOf(st, 'heal').some((e) => e.data!.source === 'reflujo_umbrio' && e.targets?.[0] === uid(0, 'litofis'))) },
};

for (const [name, c] of Object.entries(cases)) {
  test(`escenarios: ${name}`, () => c.check(duel(c)));
}

test('escenarios: todas las tecnicas y Manifestaciones equipadas tienen un caso de comprobacion', () => {
  const covered = new Set(Object.keys(cases));
  const missing: string[] = [];
  for (const f of SCENARIOS) for (const side of load(f).sides) for (const c of side.preparation.creatures) {
    for (const t of c.equippedTechniques) if (data.techniques.get(t)!.class === 'status' && !covered.has(t)) missing.push(t);
    for (const m of c.equippedManifestations) if (!covered.has(m) && m !== 'bendicion_de_llegada') missing.push(m);
  }
  assert.deepEqual([...new Set(missing)], []);
});
