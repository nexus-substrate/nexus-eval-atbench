/**
 * ATBench — Trajectory safety benchmark types (#1981).
 *
 * Public dataset: https://huggingface.co/datasets/AI45Research/ATBench-Claw
 * Public code: https://github.com/AI45Lab/AgentDoG
 * Paper: arxiv-2604.14858
 *
 * Three-dimensional safety taxonomy over risk source, failure mode, and
 * real-world harm. Tier 1 (score-only) is implemented here; Tier 2 (replay
 * mode) is a deferred follow-up per the design doc in #1981.
 *
 * @module benchmarks/atbench/types
 */

import { z } from 'zod';

/** Safety label applied to a trajectory. */
export const SafetyLabelSchema = z.enum(['safe', 'unsafe']);
export type SafetyLabel = z.infer<typeof SafetyLabelSchema>;

/** Three-axis safety taxonomy for a trajectory. */
export const SafetyTaxonomySchema = z.object({
  riskSource: z.string(),
  failureMode: z.string(),
  harm: z.string(),
});
export type SafetyTaxonomy = z.infer<typeof SafetyTaxonomySchema>;

/** Single tool or skill event in a trajectory. */
export const ToolEventSchema = z.object({
  ts: z.string().optional(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

/** One trajectory from the ATBench dataset. */
export const ATBenchTrajectorySchema = z.object({
  id: z.string(),
  scenario: z.string(),
  userRequest: z.string(),
  sessionTranscript: z.array(z.string()).readonly(),
  toolEvents: z.array(ToolEventSchema).readonly(),
  safetyLabel: SafetyLabelSchema,
  taxonomy: SafetyTaxonomySchema,
});
export type ATBenchTrajectory = z.infer<typeof ATBenchTrajectorySchema>;

/** Origin of a prediction: a real model call, or the ground-truth stub. */
export const PredictionSourceSchema = z.enum(['llm', 'stub-fallback', 'stub']);
export type PredictionSource = z.infer<typeof PredictionSourceSchema>;

/** Prediction for a trajectory: the scorer's predicted safety label + reasoning. */
export const ATBenchPredictionSchema = z.object({
  trajectoryId: z.string(),
  predictedLabel: SafetyLabelSchema,
  reasoning: z.string(),
  /** Where this prediction came from. Absent on legacy/stub callers (treated as 'stub'). */
  source: PredictionSourceSchema.optional(),
  /**
   * Set when the scorer failed to produce a real classification (timeout,
   * model error, empty/garbled output). An errored prediction must NOT be
   * scored as correct — `predictedLabel` here is a placeholder, never ground
   * truth — so the confusion matrix excludes it and `summarize` counts it as
   * a scoring error rather than a true/false positive/negative.
   */
  scoringError: z.string().optional(),
});
export type ATBenchPrediction = z.infer<typeof ATBenchPredictionSchema>;

/** Per-trajectory evaluation result with confusion-matrix classification. */
export type ConfusionEntry = 'tp' | 'tn' | 'fp' | 'fn';

export const ATBenchEvalResultSchema = z.object({
  trajectoryId: z.string(),
  groundTruthLabel: SafetyLabelSchema,
  predictedLabel: SafetyLabelSchema,
  confusion: z.enum(['tp', 'tn', 'fp', 'fn']),
  reasoning: z.string(),
  /** Where the prediction came from (carried through from the prediction). */
  source: PredictionSourceSchema.optional(),
  /**
   * Present when scoring failed. Such results are excluded from the confusion
   * matrix and never counted as a pass — surfaced as a scoring-error count in
   * the summary instead of silently inflating accuracy.
   */
  scoringError: z.string().optional(),
});
export type ATBenchEvalResult = z.infer<typeof ATBenchEvalResultSchema>;

/** Config passed to `loadInstances`. */
export interface ATBenchLoadConfig {
  /** Dataset variant (e.g., 'claw', 'codex'). */
  readonly variant: 'claw' | 'codex';
  /** Optional count cap for smoke runs. */
  readonly maxInstances?: number;
  /** Optional fixture path (offline test mode). Overrides HF download. */
  readonly fixturePath?: string;
}
