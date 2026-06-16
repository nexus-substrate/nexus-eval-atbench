/**
 * ATBench BenchmarkAdapter (#1981).
 *
 * Implements the `BenchmarkAdapter` contract so ATBench can plug into the
 * standard nexus-agents benchmark CLI / reporting surface alongside SWE-bench.
 *
 * **Current state: skeleton only —**
 * - `loadInstances` requires a fixture path (HF dataset loader is a follow-up)
 * - `runInstance` calls the stub scorer
 * - `evaluate` + `summarize` are real (confusion matrix, accuracy, F1)
 *
 * @module benchmarks/atbench/adapter
 */

import type { IModelAdapter } from 'nexus-agents';
import type { BenchmarkAdapter, BenchmarkRunContext, BenchmarkRunSummary } from 'nexus-agents';
import { fetchAtbenchFromHf } from './dataset-loader.js';
import { scoreTrajectoryViaLlm, DEFAULT_SCORER_TIMEOUT_MS } from './llm-scorer.js';
import { classifyConfusion, scoreTrajectoryStub } from './scorer.js';
import type {
  ATBenchEvalResult,
  ATBenchLoadConfig,
  ATBenchPrediction,
  ATBenchTrajectory,
} from './types.js';
import { ATBenchTrajectorySchema } from './types.js';

/** Optional adapter configuration. */
export interface ATBenchAdapterOptions {
  /** Variant of the dataset (claw or codex). Default: 'claw'. */
  readonly variant?: 'claw' | 'codex';
  /**
   * Optional IModelAdapter for LLM-based scoring. When omitted, runInstance
   * uses the perfect-oracle stub (echoes ground truth — useful for smoke
   * tests; not a real evaluation).
   */
  readonly scorerAdapter?: IModelAdapter;
  /** LLM scorer timeout in ms. Default: 5000. */
  readonly scorerTimeoutMs?: number;
}

export class ATBenchAdapter implements BenchmarkAdapter<
  ATBenchTrajectory,
  ATBenchPrediction,
  ATBenchEvalResult
> {
  readonly name = 'atbench';
  readonly variant: string;
  private readonly scorerAdapter: IModelAdapter | undefined;
  private readonly scorerTimeoutMs: number;

  constructor(variantOrOptions: 'claw' | 'codex' | ATBenchAdapterOptions = 'claw') {
    if (typeof variantOrOptions === 'string') {
      this.variant = variantOrOptions;
      this.scorerAdapter = undefined;
      this.scorerTimeoutMs = DEFAULT_SCORER_TIMEOUT_MS;
    } else {
      this.variant = variantOrOptions.variant ?? 'claw';
      this.scorerAdapter = variantOrOptions.scorerAdapter;
      this.scorerTimeoutMs = variantOrOptions.scorerTimeoutMs ?? DEFAULT_SCORER_TIMEOUT_MS;
    }
  }

  /**
   * Loads trajectories from either a local JSONL fixture (offline / CI smoke
   * test) or the public HuggingFace Datasets API (production evaluation).
   *
   * Precedence: `fixturePath` wins if provided; otherwise fetches from
   * `AI45Research/ATBench-Claw` (or `-CodeX`) via the HF Datasets Server.
   * Public datasets — no auth required.
   */
  async loadInstances(config: Record<string, unknown>): Promise<readonly ATBenchTrajectory[]> {
    const typed = config as unknown as ATBenchLoadConfig;
    const hasFixture = typeof typed.fixturePath === 'string' && typed.fixturePath.length > 0;
    return hasFixture ? loadFromFixture(typed) : loadFromHf(typed, this.variant);
  }

  async runInstance(
    instance: ATBenchTrajectory,
    _ctx: BenchmarkRunContext
  ): Promise<ATBenchPrediction> {
    if (this.scorerAdapter === undefined) {
      return Promise.resolve(scoreTrajectoryStub(instance));
    }
    const result = await scoreTrajectoryViaLlm(this.scorerAdapter, instance, this.scorerTimeoutMs);
    return result.prediction;
  }

  async evaluate(
    instance: ATBenchTrajectory,
    prediction: ATBenchPrediction
  ): Promise<ATBenchEvalResult> {
    // A failed scoring attempt is NOT credited against ground truth. We still
    // record a confusion bucket for type compatibility, but `scoringError`
    // causes summarize() to exclude it from the matrix and the pass count.
    return Promise.resolve({
      trajectoryId: instance.id,
      groundTruthLabel: instance.safetyLabel,
      predictedLabel: prediction.predictedLabel,
      confusion: classifyConfusion(prediction.predictedLabel, instance.safetyLabel),
      reasoning: prediction.reasoning,
      ...(prediction.source !== undefined ? { source: prediction.source } : {}),
      ...(prediction.scoringError !== undefined
        ? { scoringError: prediction.scoringError }
        : {}),
    });
  }

  isPass(result: ATBenchEvalResult): boolean {
    // A failed scoring attempt never passes — it is not a real classification.
    if (result.scoringError !== undefined) return false;
    // A result is a "pass" when the prediction matches ground truth.
    // (The benchmark's job is detection accuracy, not avoiding unsafe behavior.)
    return result.confusion === 'tp' || result.confusion === 'tn';
  }

  summarize(results: readonly ATBenchEvalResult[], runTimeMs: number): BenchmarkRunSummary {
    const total = results.length;
    // Errored results (timeout/model-error/garbled) carry no real prediction;
    // exclude them from the confusion matrix so metrics aren't fabricated.
    const scored = results.filter((r) => r.scoringError === undefined);
    const errored = results.filter((r) => r.scoringError !== undefined);
    const passed = results.filter((r) => this.isPass(r)).length;
    const tp = scored.filter((r) => r.confusion === 'tp').length;
    const fp = scored.filter((r) => r.confusion === 'fp').length;
    const fn = scored.filter((r) => r.confusion === 'fn').length;
    const tn = scored.filter((r) => r.confusion === 'tn').length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    // Source breakdown so any reliance on the ground-truth stub is visible.
    const sourceBreakdown = {
      llm: results.filter((r) => r.source === 'llm').length,
      stubFallback: results.filter((r) => r.source === 'stub-fallback').length,
      stub: results.filter((r) => r.source === 'stub').length,
      unknown: results.filter((r) => r.source === undefined).length,
    };

    return {
      name: this.name,
      variant: this.variant,
      total,
      passed,
      passRate: total > 0 ? passed / total : 0,
      runTimeMs,
      metadata: {
        confusionMatrix: { tp, fp, fn, tn },
        scored: scored.length,
        scoringErrors: errored.length,
        sourceBreakdown,
        precision,
        recall,
        f1,
        positiveClass: 'unsafe',
      },
    };
  }
}

/** Read trajectories from a local JSONL fixture. */
async function loadFromFixture(typed: ATBenchLoadConfig): Promise<readonly ATBenchTrajectory[]> {
  const { readFile } = await import('node:fs/promises');
  const path = typed.fixturePath as string;
  const raw = await readFile(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const trajectories: ATBenchTrajectory[] = lines.map((line, idx) => {
    const parsed = ATBenchTrajectorySchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(
        `ATBench fixture line ${String(idx + 1)} failed schema validation: ${parsed.error.message}`
      );
    }
    return parsed.data;
  });
  return typeof typed.maxInstances === 'number'
    ? trajectories.slice(0, typed.maxInstances)
    : trajectories;
}

/** Fetch trajectories from HuggingFace Datasets API. */
async function loadFromHf(
  typed: ATBenchLoadConfig,
  adapterVariant: string
): Promise<readonly ATBenchTrajectory[]> {
  // typed.variant is declared required on ATBenchLoadConfig but the runtime
  // call site may omit it; treat it as optional and fall back to the adapter's
  // own variant.
  const requested = (typed as { variant?: 'claw' | 'codex' }).variant;
  const variant: 'claw' | 'codex' = requested ?? (adapterVariant === 'codex' ? 'codex' : 'claw');
  const result = await fetchAtbenchFromHf({
    variant,
    ...(typeof typed.maxInstances === 'number' ? { limit: typed.maxInstances } : {}),
  });
  if (!result.ok) {
    throw new Error(`ATBench HF load failed: ${result.error.message}`);
  }
  return result.value.trajectories;
}
