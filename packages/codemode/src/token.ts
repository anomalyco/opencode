/**
 * Token estimation for budgeting model-facing text. Copied from
 * `@opencode-ai/core/util/token` (chars / 4) so this package stays
 * dependency-free; keep the two in sync if the heuristic ever changes.
 */
export * as Token from "./token.js"

const CHARS_PER_TOKEN = 4

export const estimate = (input: string) => Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))
