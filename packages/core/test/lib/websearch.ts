export * as TestWebSearch from "./websearch"

import { Context, Deferred, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { WebSearch } from "@opencode-ai/core/websearch"

export interface Interface extends WebSearch.Interface {
  readonly queries: readonly WebSearch.Input[]
  /** Waits for query arrivals, not provider execution or query completion. */
  readonly wait: (count: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("test/WebSearch") {}

// No providers are installed: tests register local executors through transform.
// The normal Bus and KV implementations use the default in-memory database.
export const layer = Layer.effectContext(
  Effect.gen(function* () {
    const context = yield* Layer.build(AppNodeBuilder.build(LayerNode.group([WebSearch.node, Bus.node, KV.node])))
    const websearch = Context.get(context, WebSearch.Service)
    const queries: WebSearch.Input[] = []
    let started = yield* Deferred.make<void>()
    const wait = (count: number): Effect.Effect<void> =>
      Effect.suspend(() =>
        queries.length >= count ? Effect.void : Deferred.await(started).pipe(Effect.andThen(() => wait(count))),
      )
    const test = Service.of({
      ...websearch,
      queries,
      wait,
      query: Effect.fnUntraced(function* (input: WebSearch.Input) {
        queries.push({ ...input })
        const previous = started
        started = yield* Deferred.make<void>()
        yield* Deferred.succeed(previous, undefined)
        return yield* websearch.query(input)
      }),
    })
    return Context.add(context, WebSearch.Service, test).pipe(Context.add(Service, test))
  }),
)
