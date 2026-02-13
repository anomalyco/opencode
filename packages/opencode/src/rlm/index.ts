/**
 * RLM - Recursive Language Model
 *
 * Native TypeScript port of the RLM system for OpenCode.
 * Provides iterative REPL-based reasoning with recursive sub-LLM queries.
 *
 * @module rlm
 */

export * as RLMContext from "./context"
export { LocalREPL, type LocalREPLOptions, type LLMQueryHandler, type LLMQueryBatchedHandler } from "./environment"
export type {
  REPLResult,
} from "./types"
export { emptyREPLResult } from "./types"
