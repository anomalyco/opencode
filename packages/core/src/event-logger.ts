export * as EventLogger from "./event-logger"

import { Effect, Layer, Stream } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { Catalog } from "@opencode-ai/schema/catalog"
import { Command } from "@opencode-ai/schema/command"
import { Config } from "@opencode-ai/schema/config"
import { makeGlobalNode } from "./effect/app-node"
import { EventV2 } from "./event"

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    yield* events
      .subscribe([Agent.Event.Updated, Catalog.Event.Updated, Command.Event.Updated, Config.Event.Updated])
      .pipe(
        Stream.runForEach((event) => Effect.logInfo("event", { event })),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
)

export const node = makeGlobalNode({ name: "event-logger", layer, deps: [EventV2.node] })
