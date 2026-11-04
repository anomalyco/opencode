import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { Plugin } from "@opencode/plugin/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Document, Info } from "@opencode/schema/config"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { WarmingPlugin } from "@opencode/core/plugin/warming"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_warming")
const warming = { on: true }
const entries = () => (warming.on ? [new Document({ type: "document", info: new Info({ warming: true }) })] : [])
const it = testEffect(
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () => Effect.sync(entries),
      snapshot: entries,
      changes: () => Stream.empty,
    }),
  ),
)

const event = (): SessionHooks["context"] => ({
  sessionID,
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
  system: [],
  messages: [],
  tools: {},
  options: {},
})

describe("WarmingPlugin", () => {
  it.effect("keeps one loop when a Session is scheduled again before its old loop wakes", () =>
    Effect.gen(function* () {
      const hooks = new Map<string, (event: SessionHooks["context"]) => Effect.Effect<void>>()
      const pings: number[] = []
      const session: Partial<Plugin.Context["session"]> = {
        // SAFETY: the warming plugin registers context-shaped hooks, which this test triggers directly.
        hook: ((name: string, callback: (event: SessionHooks["context"]) => Effect.Effect<void>) =>
          Effect.sync(() => void hooks.set(name, callback))) as never,
        // SAFETY: the plugin reads only the parent of a Session.
        get: () => Effect.succeed({ id: sessionID } as unknown as Session.Info),
        // A ping takes a while, so a second loop that wakes during it still sees the old last ping.
        generate: () =>
          Effect.sync(() => void pings.push(pings.length)).pipe(Effect.andThen(Effect.sleep("10 seconds"))) as never,
      }
      yield* WarmingPlugin.Plugin.effect(
        host({
          session,
          model: {
            // SAFETY: an empty catalog falls back to the model's defaults.
            list: () => Effect.succeed({ data: [] }) as never,
            default: () => Effect.die("unused model.default"),
            transform: () => Effect.die("unused model.transform"),
            reload: () => Effect.die("unused model.reload"),
          },
        }),
      )
      const generate = hooks.get("generate")!

      yield* generate(event())
      yield* TestClock.adjust(Duration.minutes(1))
      warming.on = false
      yield* generate(event())
      yield* TestClock.adjust(Duration.minutes(1))
      warming.on = true
      yield* generate(event())

      // The first loop would have woken at 4 minutes; the second pings at 6, then 4 minutes after that ping ends.
      yield* TestClock.adjust(Duration.minutes(4))
      expect(pings).toHaveLength(1)
      yield* TestClock.adjust(Duration.seconds(250))
      expect(pings).toHaveLength(2)
    }),
  )
})
