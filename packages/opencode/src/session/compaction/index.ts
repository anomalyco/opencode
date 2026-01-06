/**
 * Hybrid Compaction Module
 *
 * Provides a structured compaction pipeline that combines:
 * - Deterministic extraction (files, errors, tool calls)
 * - LLM-based semantic extraction (intent, state, decisions)
 * - Quality validation
 *
 * @module compaction
 */

export { CompactionSchema } from "./schema"
export { DeterministicExtractor } from "./extractors"
export { LLMExtractor } from "./llm-extractor"
export { QualityScorer } from "./quality"
export { HybridCompactionPipeline } from "./pipeline"
