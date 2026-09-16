import { describe, expect } from "bun:test"
import { Message } from "@opencode/ai"
import { Config } from "@opencode/core/config"
import { Model } from "@opencode/core/model"
import { WarmingPlugin } from "@opencode/core/plugin/warming"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/core/schema"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import { Document, Info } from "@opencode/schema/config"
import { Location } from "@opencode/schema/location"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { DateTime, Duration, Effect } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../lib/effect"
import { host } from "./host"

const rootID = Session.ID.make("ses_warming_root")
const childID = Session.ID.make("ses_warming_child")
const root = session(rootID)
const child = session(childID, rootID)

const config = Config.testLayer([
  new Document({
    type: "document",
    info: new Info({
      warming: { prompt: "warm", interval: Duration.minutes(4), duration: Duration.minutes(30) },
    }),
  }),
])

const run = Effect.fnUntraced(function* () {
  const generated = new Array<Session.ID>()
  let hook: ((input: SessionHooks["context"]) => Effect.Effect<void>) | undefined
  yield* WarmingPlugin.Plugin.effect(
    host({
      session: {
        hook: (name, callback) => {
          if (name === "context") hook = callback as (input: SessionHooks["context"]) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
        get: (input) => Effect.succeed(input.sessionID === childID ? child : root),
        generate: (input) => Effect.sync(() => generated.push(input.sessionID)).pipe(Effect.as({ text: "OK" })),
      },
    }),
  )
  if (!hook) return yield* Effect.die("warming plugin did not register a context hook")
  return { generated, hook }
})

const request = (sessionID: Session.ID): SessionHooks["context"] => ({
  sessionID,
  agent: Agent.ID.make("build"),
  model: { id: Model.ID.make("test"), providerID: Provider.ID.make("test") },
  system: [],
  messages: [Message.user("hello")],
  tools: {},
  options: {},
})

describe("warming plugin", () => {
  it.effect("warms root sessions but not subagent sessions", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.hook(request(rootID))
      yield* warming.hook(request(childID))
      yield* TestClock.adjust(Duration.minutes(4))

      expect(warming.generated).toContain(rootID)
      expect(warming.generated).not.toContain(childID)
    }).pipe(Effect.provide(config)),
  )
})

function session(id: Session.ID, parentID?: Session.ID) {
  return Session.Info.make({
    id,
    parentID,
    projectID: Project.ID.global,
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
  })
}
