/**
 * Evaluation framework for assessing trace quality
 * 
 * This module provides:
 * - Trace materialization from sessions
 * - Metric definitions and registry
 * - Evaluation engine to run metrics against traces
 * - Built-in heuristics for common quality checks
 */

export { Trace } from "../trace"
export { Metric } from "./metric"
export { EvaluationEngine } from "./engine"
export { Heuristics } from "./heuristics"
export { BuiltinMetrics, registerBuiltinMetrics } from "./metrics/builtin"
