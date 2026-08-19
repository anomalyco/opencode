import { Config } from "@/config/config"
import { emptyConsoleState } from "@opencode-ai/core/v1/config/console-state"
import { Effect, Layer } from "effect"

export function make(overrides: Partial<Config.Interface> = {}) {
  return Config.Service.of({
    get: () => Effect.succeed({}),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed(emptyConsoleState),
    update: () => Effect.void,
    // A patch may carry `null` members (RFC 7396 removals) that `Info` does
    // not accept; the real service resolves them against the file, so the stub
    // just reports an empty config rather than echoing the patch back.
    updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
    invalidate: () => Effect.void,
    directories: () => Effect.succeed([]),
    waitForDependencies: () => Effect.void,
    ...overrides,
  })
}

export function layer(overrides?: Partial<Config.Interface>) {
  return Layer.succeed(Config.Service, make(overrides))
}

export * as TestConfig from "./config"
