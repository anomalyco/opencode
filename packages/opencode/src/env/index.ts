import { Context, Effect, Layer } from "effect"

/**
 * Effect-aware wrapper around `process.env`.
 *
 * Contract:
 * - Reads (`get`, `all`) are LIVE — they reflect the current `process.env` at
 *   call time, not a snapshot taken at layer construction. `all()` returns a
 *   fresh shallow copy, so iterating the result is safe across subsequent
 *   writes.
 * - Writes (`set`, `remove`) mutate `process.env` directly and therefore
 *   propagate to any child process spawned afterward and to native consumers
 *   (e.g. `getenv()` inside vendor SDKs).
 * - NOT safe for parallel test isolation: all callers share one global
 *   `process.env`. Tests that mutate env state must serialize within a file
 *   and rely on `test/preload.ts` afterEach baseline restore for cross-file
 *   safety.
 * - NOT per-instance isolated: `set`/`remove` write to the process-wide
 *   `process.env`. In multi-instance hosts (e.g. desktop app where one
 *   sidecar process serves several workspace contexts) two workspaces
 *   authenticating to the same provider with different credentials will
 *   clobber each other — last write wins. KNOWN LIMITATION; the existing
 *   call sites that persist auth-derived values through `Env.set` are
 *   marked with `TODO(multi-instance)` for a future Auth-routing migration.
 */
type State = Record<string, string | undefined>

export interface Interface {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly all: () => Effect.Effect<State>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Env") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    // get/all are untraced: every Provider read goes through env.all(); a span
    // around a literal `process.env[k]` access is hot-path noise. Trace
    // set/remove where the side effect is interesting.
    get: (key: string) => Effect.sync(() => process.env[key]),
    all: () => Effect.sync(() => ({ ...process.env })),
    set: Effect.fn("Env.set")((key: string, value: string) =>
      Effect.sync(() => {
        process.env[key] = value
      }),
    ),
    remove: Effect.fn("Env.remove")((key: string) =>
      Effect.sync(() => {
        delete process.env[key]
      }),
    ),
  }),
)

export const defaultLayer = layer

export * as Env from "."
