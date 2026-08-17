import { describe, expect } from "bun:test"
import { Message } from "@opencode-ai/ai"
import { DateTime, Effect, Stream } from "effect"
import type { SessionContext } from "@opencode-ai/plugin/effect/session"
import { Agent } from "@opencode-ai/core/agent"
import { Event } from "@opencode-ai/schema/event"
import { Model } from "@opencode-ai/core/model"
import { PlanPlugin } from "@opencode-ai/core/plugin/plan"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_plan_test")
const plan = Agent.ID.make("plan")
const build = Agent.ID.make("build")

const agentSelected = (agent: Agent.ID, previous: Agent.ID): SessionEvent.AgentSelected => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.agent.selected",
  data: { sessionID, agent, previous },
})

/** Runs the plan plugin against stubbed domains, capturing persisted reminders and the context hook. */
const run = Effect.fnUntraced(function* (events: ReadonlyArray<SessionEvent.AgentSelected> = []) {
  const persisted = new Array<string>()
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  yield* PlanPlugin.Plugin.effect(
    host({
      agent: {
        get: () => Effect.die("unused agent.get"),
        list: () => Effect.die("unused agent.list"),
        reload: () => Effect.die("unused agent.reload"),
        transform: () => Effect.succeed({ dispose: Effect.void }),
      },
      tool: {
        transform: () => Effect.die("unused tool.transform"),
        hook: () => Effect.succeed({ dispose: Effect.void }),
      },
      event: {
        subscribe: () => Stream.fromIterable(events),
      },
      session: {
        hook: (name, callback) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
        synthetic: (input) => {
          persisted.push(input.text)
          return Effect.succeed(
            SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_plan_test"),
              sessionID,
              timeCreated: DateTime.makeUnsafe(0),
              type: "synthetic",
              payload: { text: input.text },
              delivery: "steer",
            }),
          )
        },
      },
    }),
  )
  if (!contextHook) return yield* Effect.die("plan plugin did not register a context hook")
  return { persisted, contextHook }
})

const request = (agent: Agent.ID, messages: Array<Message>): SessionContext => ({
  sessionID,
  agent,
  model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
  system: [],
  messages,
  tools: {},
})

const settle = (persisted: ReadonlyArray<string>, expected: number, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (persisted.length >= expected) return
    if (remaining === 0) {
      return yield* Effect.fail(new Error(`Timed out waiting for ${expected} reminders, saw ${persisted.length}`))
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* settle(persisted, expected, remaining - 1)
  })

/** The exact reminder texts, derived from plugin behavior rather than duplicated here. */
const reminders = Effect.gen(function* () {
  const planRun = yield* run()
  yield* planRun.contextHook(request(plan, []))
  const buildRun = yield* run()
  yield* buildRun.contextHook(request(build, [Message.user(planRun.persisted[0]!)]))
  return { enter: planRun.persisted[0]!, leave: buildRun.persisted[0]! }
})

describe("plan plugin reminders", () => {
  it.effect("injects enter and leave reminders on agent switches", () =>
    Effect.gen(function* () {
      const { persisted } = yield* run([agentSelected(plan, build), agentSelected(build, plan)])
      yield* settle(persisted, 2)
      expect(persisted[0]).toContain("You are in Plan mode")
      expect(persisted[1]).toContain("NO LONGER in Plan mode")
    }),
  )

  it.effect("reconciles a missing enter reminder into the request and persists it", () =>
    Effect.gen(function* () {
      const { persisted, contextHook } = yield* run()
      const messages = [Message.user("what agent are you?")]
      yield* contextHook(request(plan, messages))
      expect(messages).toHaveLength(2)
      // Inserted before the user's prompt, matching where agent-switch reminders land.
      const first = messages[0]?.content[0]
      expect(first?.type === "text" && first.text).toContain("You are in Plan mode")
      expect(persisted).toHaveLength(1)
    }),
  )

  it.effect("does nothing when the transcript already has a live enter reminder", () =>
    Effect.gen(function* () {
      const { enter } = yield* reminders
      const { persisted, contextHook } = yield* run()
      const messages = [Message.user(enter), Message.user("hello")]
      yield* contextHook(request(plan, messages))
      expect(messages).toHaveLength(2)
      expect(persisted).toHaveLength(0)
    }),
  )

  it.effect("reconciles a stale enter reminder with a leave reminder", () =>
    Effect.gen(function* () {
      const { enter } = yield* reminders
      const { persisted, contextHook } = yield* run()
      const messages = [Message.user(enter), Message.user("ok implement it")]
      yield* contextHook(request(build, messages))
      expect(messages).toHaveLength(3)
      const middle = messages[1]?.content[0]
      expect(middle?.type === "text" && middle.text).toContain("NO LONGER in Plan mode")
      expect(persisted).toHaveLength(1)
    }),
  )

  it.effect("does nothing for non-plan sessions without plan history", () =>
    Effect.gen(function* () {
      const { persisted, contextHook } = yield* run()
      const messages = [Message.user("hello")]
      yield* contextHook(request(build, messages))
      expect(messages).toHaveLength(1)
      expect(persisted).toHaveLength(0)
    }),
  )

  it.effect("does nothing when a leave reminder already follows the enter reminder", () =>
    Effect.gen(function* () {
      const { enter, leave } = yield* reminders
      const { persisted, contextHook } = yield* run()
      const messages = [Message.user(enter), Message.user(leave), Message.user("continue")]
      yield* contextHook(request(build, messages))
      expect(messages).toHaveLength(3)
      expect(persisted).toHaveLength(0)
    }),
  )

  it.effect("treats reminder text quoted inside a larger message as not live", () =>
    Effect.gen(function* () {
      const { enter } = yield* reminders
      const { persisted, contextHook } = yield* run()
      // Mirrors a compaction checkpoint quoting the reminder inside <recent-context>.
      const messages = [Message.user(`<conversation-checkpoint>\n${enter}\n</conversation-checkpoint>`)]
      yield* contextHook(request(plan, messages))
      expect(messages).toHaveLength(2)
      expect(persisted).toHaveLength(1)
    }),
  )
})
