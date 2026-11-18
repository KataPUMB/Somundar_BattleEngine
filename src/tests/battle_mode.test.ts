import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../engine/pipeline/battle.js';
import { legalActions, validateDeclaration } from '../engine/legality/actions.js';
import type { Action } from '../engine/model/battle.js';
import type { SideSetup } from '../engine/model/types.js';
import { creature, loadData, summoner } from './helpers.js';

const data = loadData();

function massiveSide(tag: string): SideSetup {
  const creatures = Array.from({ length: 15 }, (_, i) => creature(`${tag}${i}`, { equippedTechniques: ['aranazo'] }));
  return {
    battleMode: true,
    summoner: summoner(`sum-${tag}`, 'iniciado', { amplitude: null }),
    preparation: { creatures },
    initialDeployment: creatures.map((c) => c.id),
  };
}

test('modo batalla: crea 15 posiciones por lado y despliega 15 vs 15', () => {
  const st = createBattle(data, [massiveSide('a'), massiveSide('b')], { seed: 7 });
  assert.equal(st.sides[0].positions.length, 15);
  assert.equal(st.sides[1].positions.length, 15);
  assert.equal(st.sides[0].positions.filter((p) => p.occupantUid !== null).length, 15);
  assert.equal(st.sides[1].positions.filter((p) => p.occupantUid !== null).length, 15);
});

test('modo batalla: una posicion puede declarar objetivo en cualquier rival del lado opuesto', () => {
  const st = createBattle(data, [massiveSide('a'), massiveSide('b')], { seed: 11 });
  const ctx = { data, st, controllers: {} };
  const opts = legalActions(ctx, 'S0P0');
  const attack = opts.find((o) => o.legal && o.action.kind === 'technique' && o.action.techniqueId === 'aranazo');
  assert.ok(attack);
  assert.ok((attack!.targetPositions ?? []).includes('S1P14'));
  const decl: Action = { kind: 'technique', techniqueId: 'aranazo', target: { kind: 'position', positionId: 'S1P14' } };
  assert.equal(validateDeclaration(ctx, 'S0P0', decl), null);
});
