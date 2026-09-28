import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGameData } from '../data/loader.js';
import { buildCoverageReport, formatCoverage } from '../data/coverage.js';
import type { EffectsMode } from '../engine/effects/availability.js';
import type { BattleConfig } from '../engine/model/battle.js';
import type { SideSetup } from '../engine/model/types.js';
import { validatePreparation } from '../engine/legality/preparation.js';
import { randomLegalPolicy } from '../engine/ai/random.js';
import { RULE_GAPS } from '../engine/gaps.js';
import { runBattle } from './simulate.js';
import { askReplacement, humanPolicy } from './human.js';
import { formatEvent } from './format.js';
import type { BattleState, SideIndex } from '../engine/model/battle.js';
import type { Policy } from '../engine/ai/random.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(argv: string[]): number {
  const [cmd, ...args] = argv;
  const dataDir = resolve(flag(args, 'data') ?? 'Data');
  const json = args.includes('--json');
  const { data, issues } = loadGameData(dataDir);
  const errors = issues.filter((i) => i.severity === 'error');

  switch (cmd) {
    case 'validate-data': {
      for (const i of issues) console.log(`${i.severity.toUpperCase()} ${i.file}${i.id ? ` [${i.id}]` : ''}: ${i.message}`);
      console.log(`${errors.length} errores, ${issues.length - errors.length} avisos`);
      return errors.length > 0 ? 1 : 0;
    }
    case 'coverage': {
      const mode = (flag(args, 'mode') ?? 'strict') as EffectsMode;
      const r = buildCoverageReport(data, mode);
      console.log(json ? JSON.stringify(r, null, 2) : formatCoverage(r));
      return 0;
    }
    case 'gaps': {
      for (const g of RULE_GAPS) console.log(`${g.id} (${g.ruleRef})\n  ? ${g.question}\n  = ${g.assumption}`);
      return 0;
    }
    case 'validate': {
      const setup = JSON.parse(readFileSync(resolve(args[0] ?? ''), 'utf-8')) as SideSetup;
      const v = validatePreparation(setup, data);
      for (const x of v) console.log(`${x.severity.toUpperCase()} ${x.code} (${x.ruleRef})${x.path ? ` ${x.path}` : ''}: ${x.message}`);
      return v.some((x) => x.severity === 'error') ? 1 : 0;
    }
    case 'simulate': {
      if (errors.length > 0) {
        console.error('Data/ contiene errores; ejecuta validate-data');
        return 1;
      }
      const sc = JSON.parse(readFileSync(resolve(args[0] ?? ''), 'utf-8')) as { sides: [SideSetup, SideSetup]; seed?: number; config?: Partial<BattleConfig> };
      const seed = Number(flag(args, 'seed') ?? sc.seed ?? 1);
      const mode = flag(args, 'mode') as EffectsMode | undefined;
      const humanArg = flag(args, 'human');
      const human = [humanArg === '0' || humanArg === 'both', humanArg === '1' || humanArg === 'both'];
      const pretty = args.includes('--pretty') || human.some(Boolean);
      let printed = 0;
      const flush = (st: BattleState) => {
        for (const e of st.log) {
          if (e.id <= printed) continue;
          printed = e.id;
          const line = pretty ? formatEvent(data, st, e) : `#${e.id} R${e.round} ${e.phase} ${e.type}${e.actor ? ` ${e.actor}` : ''}${e.data ? ` ${JSON.stringify(e.data)}` : ''}`;
          if (line !== null) console.log(line);
        }
      };
      const policies = [0, 1].map((s) => (human[s] ? humanPolicy(data) : randomLegalPolicy)) as [Policy, Policy];
      const controllers = {
        chooseReplacement: (st: BattleState, side: SideIndex, pid: string, candidates: string[]) => {
          if (!human[side]) return candidates[0]!;
          flush(st);
          return askReplacement(st, pid, candidates);
        },
      };
      const st = runBattle(data, sc.sides, policies, {
        seed,
        config: { ...sc.config, ...(mode ? { effectsMode: mode } : {}) },
        controllers,
        onUpdate: json ? undefined : flush,
      });
      if (json) console.log(JSON.stringify(st.log, null, 2));
      else console.log(`Resultado: ${JSON.stringify(st.outcome)}`);
      return 0;
    }
    default:
      console.log('Uso: cli <validate-data | coverage [--mode strict|lenient] [--json] | gaps | validate <setup.json> | simulate <escenario.json> [--seed N] [--mode M] [--human 0|1|both] [--pretty] [--json]> [--data DIR]');
      return cmd ? 1 : 0;
  }
}

process.exitCode = main(process.argv.slice(2));
