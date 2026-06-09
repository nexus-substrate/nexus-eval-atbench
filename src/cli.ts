#!/usr/bin/env node
/**
 * nexus-eval-atbench CLI.
 *
 * Usage:
 *   nexus-eval-atbench [run] [--variant claw|codex] [--fixture PATH] [--limit N]
 *   nexus-eval-atbench --json > results.json
 *   nexus-eval-atbench --help
 *
 * @module cli
 */

import { parseArgs } from 'node:util';
import { runBenchmark } from 'nexus-agents';
import { ATBenchAdapter } from './adapter.js';
import packageJson from '../package.json' with { type: 'json' };

const HELP = `nexus-eval-atbench — Atbench (agent-trajectory safety) evaluation harness

Usage:
  nexus-eval-atbench [run] [options]
  nexus-eval-atbench --version
  nexus-eval-atbench --help

Options:
  --variant <claw|codex>   ATBench variant. Default: claw.
  --fixture <path>         Local JSONL fixture (overrides HF dataset).
  --limit <n>              Limit instances evaluated. Default: all.
  --concurrency <n>        Max parallel solver calls. Default: 1.
  --timeout <ms>           Per-instance timeout. Default: 300000.
  --json                   Emit JSON summary instead of human text.
  --help, -h               Show this help.
  --version, -v            Show version.
`;

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`nexus-eval-atbench ${packageJson.version}\n`);
    return 0;
  }

  const parsed = parseArgs({
    args: args[0] === 'run' ? args.slice(1) : args,
    options: {
      variant: { type: 'string' },
      fixture: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '300000' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const limit = parsed.values.limit !== undefined ? Number(parsed.values.limit) : undefined;
  const concurrency = Number(parsed.values.concurrency ?? '1');
  const timeoutMs = Number(parsed.values.timeout ?? '300000');
  const variant = parsed.values.variant === 'codex' ? 'codex' : 'claw';

  const adapter = new ATBenchAdapter({ variant });

  const loadConfig: Record<string, unknown> = { variant };
  if (parsed.values.fixture !== undefined) {
    loadConfig['fixturePath'] = parsed.values.fixture;
  }
  if (limit !== undefined) {
    loadConfig['maxInstances'] = limit;
  }

  const summary = await runBenchmark(adapter, loadConfig, {
    concurrency,
    instanceTimeoutMs: timeoutMs,
    ...(limit !== undefined ? { limit } : {}),
    onProgress: (done: number, total: number): void => {
      if (!parsed.values.json) {
        process.stderr.write(`[${String(done)}/${String(total)}]\r`);
      }
    },
  });

  if (parsed.values.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write('\n');
    process.stdout.write(`${adapter.name} (${adapter.variant})\n`);
    process.stdout.write(`  passed:  ${String(summary.passed)} / ${String(summary.total)}\n`);
    process.stdout.write(`  rate:    ${(summary.passRate * 100).toFixed(1)}%\n`);
    process.stdout.write(`  runtime: ${(summary.runTimeMs / 1000).toFixed(1)}s\n`);
  }

  return summary.passed === summary.total ? 0 : 1;
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exit(2);
  });
