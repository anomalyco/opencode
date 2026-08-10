export * as LLM from "./llm.js"

import { Schema } from "effect"

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = typeof FinishReason.Type
