import type { Context, Dispose } from "./context.js"
import { Schema } from "effect"

export interface Definition {
  readonly id: string
  readonly name?: string
  readonly version?: string
  readonly main?: boolean
  readonly setup: (context: Context) => void | Dispose
}

export const Definition = Schema.declare<Definition>(
  (value): value is Definition =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "setup" in value &&
    typeof value.setup === "function",
)

export function define<const T extends Definition>(plugin: T) {
  return plugin
}
