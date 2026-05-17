# nexus-eval-atbench

Atbench (agent-trajectory safety) evaluation harness for [nexus-agents](https://github.com/nexus-substrate/nexus-agents) — implements the `BenchmarkAdapter` contract from nexus-agents ≥ 2.33.1.

> Source: extracted from in-tree `packages/nexus-agents/src/benchmarks/atbench/` per the nexus-agents harness-extraction policy ([epic #2514](https://github.com/nexus-substrate/nexus-agents/issues/2514), originally [#1960](https://github.com/nexus-substrate/nexus-agents/issues/1960)).

## What this benchmark measures

Atbench evaluates an agent's **trajectory safety** — given a recorded session of (user request → tool calls → outputs), can a scorer correctly classify whether the trajectory was safe or unsafe? The benchmark surfaces:

- **Confusion matrix** (TP/TN/FP/FN) over a labelled trajectory set
- **Precision / recall / F1** for the unsafe class
- Two harness variants: `claw` (default — for ClawGuard-style trajectory analysis) and `codex` (the upstream Codex-style scorer)

## Install

```sh
npm install nexus-eval-atbench nexus-agents
```

`nexus-agents` is a peer dependency.

## Quick start

```sh
# Run against the bundled fixture
npx nexus-eval-atbench --fixture ./fixtures/sample.jsonl

# Run against the HuggingFace dataset (when available)
npx nexus-eval-atbench --variant claw --limit 10

# JSON summary
npx nexus-eval-atbench --json --fixture ./fixtures/sample.jsonl > run.json
```

## Library usage

```ts
import { runBenchmark } from 'nexus-agents';
import { ATBenchAdapter } from 'nexus-eval-atbench';

const adapter = new ATBenchAdapter({ variant: 'claw' });
const summary = await runBenchmark(adapter, { fixturePath: './fixtures/sample.jsonl' });
console.log(`F1: ${summary.metadata.f1}, precision: ${summary.metadata.precision}`);
```

### LLM-scored trajectories

The default `runInstance` uses a heuristic stub scorer. Pass a real `IModelAdapter` to score with an LLM:

```ts
const adapter = new ATBenchAdapter({
  variant: 'claw',
  scorerAdapter: myModelAdapter,
  scorerTimeoutMs: 5000,
});
```

## What this harness does

- Loads ATBench instances from a local JSONL fixture or the HuggingFace dataset.
- Runs each trajectory through the configured scorer (stub heuristic or LLM).
- Compares the scorer's predicted label (`safe` / `unsafe`) against ground truth.
- Aggregates into a confusion matrix + precision/recall/F1.

## Migration note (for nexus-agents users)

Prior to this extraction, atbench shipped as `nexus-agents atbench` CLI subcommand and as `import('nexus-agents/benchmarks/atbench')`. Both are now deprecated. Migration:

```diff
- npx nexus-agents atbench --fixture ./fixture.jsonl
+ npx nexus-eval-atbench --fixture ./fixture.jsonl

- import { ATBenchAdapter } from 'nexus-agents/benchmarks/atbench';
+ import { ATBenchAdapter } from 'nexus-eval-atbench';
```

The in-tree code will be removed from nexus-agents after this package is published. See [nexus-agents #2516](https://github.com/nexus-substrate/nexus-agents/issues/2516) for tracking.

## The contract

`BenchmarkAdapter` from nexus-agents:

```ts
interface BenchmarkAdapter<TInstance, TPrediction, TEvalResult> {
  readonly name: string;
  readonly variant?: string;
  loadInstances(config): Promise<readonly TInstance[]>;
  runInstance(instance, ctx): Promise<TPrediction>;
  evaluate(instance, prediction): Promise<TEvalResult>;
  isPass(result): boolean;
  summarize(results, runTimeMs): BenchmarkRunSummary;
}
```

The orchestrator (`runBenchmark` in nexus-agents) handles concurrency, timeouts, progress, and partial failure.

## License

MIT.
