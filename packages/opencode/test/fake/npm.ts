import { Npm } from "@opencode-ai/core/npm"
import { Effect, Layer } from "effect"

export const noop = Layer.mock(Npm.Service)({
  install: () => Effect.void,
})

export * as NpmTest from "./npm"
