import { Effect, Layer } from "effect"

export type Status = { readonly status: "completed" }

export const layer = Layer.empty
export function accept() {
  return Effect.void
}
export function status() {
  return Effect.succeed({ status: "completed" } as const)
}
export function run() {
  return Effect.succeed({ status: "completed" } as const)
}
