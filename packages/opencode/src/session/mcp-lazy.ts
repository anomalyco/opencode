import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer } from "effect"
import type { SessionID } from "./schema"

// Item 28: per-session MCP tool ACTIVATION state for the lazy mode. A lazy
// session starts with NO MCP tools registered (only the synthetic
// `tool_search` meta-tool); a tool_search hit writes the matched keys into
// this set, and the NEXT resolve() of the same session registers them fully —
// the prompt loop re-resolves tools on every step, which carries the
// activation without any new protocol. In-memory and instance-local by
// design: after a restart the model simply searches again (accepted; the
// index is cheap).

type State = Map<string, Set<string>>

export interface Interface {
  /** The MCP tool keys activated for this session so far (empty set when none). */
  readonly get: (sessionID: SessionID) => Effect.Effect<ReadonlySet<string>>
  /** Adds keys to the session's activation set (idempotent). */
  readonly add: (sessionID: SessionID, keys: Iterable<string>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpLazyActivation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("McpLazyActivation.state")(function* () {
        return new Map<string, Set<string>>()
      }),
    )

    const get = Effect.fn("McpLazyActivation.get")(function* (sessionID: SessionID) {
      const map = yield* InstanceState.get(state)
      return (map.get(sessionID) ?? new Set<string>()) as ReadonlySet<string>
    })

    const add = Effect.fn("McpLazyActivation.add")(function* (sessionID: SessionID, keys: Iterable<string>) {
      const map = yield* InstanceState.get(state)
      const set = map.get(sessionID) ?? new Set<string>()
      for (const key of keys) set.add(key)
      map.set(sessionID, set)
    })

    return Service.of({ get, add })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as McpLazyActivation from "./mcp-lazy"
