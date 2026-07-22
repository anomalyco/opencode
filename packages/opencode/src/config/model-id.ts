import { Schema } from "effect"

// A branded string schema for model identifiers (e.g. "anthropic/claude-4", "openai/gpt-4o").
// This is a thin wrapper around Schema.String for now; add pattern validation
// (e.g. provider/model format) when validation requirements emerge.
export const ConfigModelID: Schema.Schema<string> = Schema.String
export type ConfigModelID = string
