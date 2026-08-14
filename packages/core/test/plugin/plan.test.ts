import { describe, expect } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Event } from "@opencode-ai/schema/event"
import { Money } from "@opencode-ai/schema/money"
import { PlanPlugin } from "@opencode-ai/core/plugin/plan"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Project } from "@opencode-ai/core/project"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_plan_test")
const plan = Agent.ID.make("plan")
const build = Agent.ID.make("build")

const envelope = () => ({
  id: Event.ID.create(),
  created: DateTime.makeUnsafe(0),
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
})

const agentSelected = (agent: Agent.ID, previous: Agent.ID): SessionEvent.AgentSelected => ({
  ...envelope(),
  type: "session.agent.selected",
  data: { sessionID, agent, previous },
})

const compactionEnded = (): SessionEvent.Compaction.Ended => ({
  ...envelope(),
  type: "session.compaction.ended",
  data: { sessionID, reason: "manual", text: "summary", recent: "" },
})

const sessionInfo = (agent?: Agent.ID): Session.Info => ({
  id: sessionID,
  projectID: Project.ID.make("test"),
  agent,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: { directory: AbsolutePath.make("/") },
})

/** Runs the plan plugin against stubbed domains and captures injected reminders. */
const run = Effect.fnUntraced(function* (
  events: ReadonlyArray<SessionEvent.AgentSelected | SessionEvent.Compaction.Ended>,
  agent?: Agent.ID,
) {
  const captured = new Array<string>()
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
        get: () => Effect.succeed(sessionInfo(agent)),
        synthetic: (input) => {
          captured.push(input.text)
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
  return captured
})

const settle = (captured: ReadonlyArray<string>, expected: number, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (captured.length >= expected) return
    if (remaining === 0) {
      return yield* Effect.fail(new Error(`Timed out waiting for ${expected} reminders, saw ${captured.length}`))
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* settle(captured, expected, remaining - 1)
  })

describe("plan plugin reminders", () => {
  it.effect("injects enter and leave reminders on agent switches", () =>
    Effect.gen(function* () {
      const captured = yield* run([agentSelected(plan, build), agentSelected(build, plan)])
      yield* settle(captured, 2)
      expect(captured[0]).toContain("You are in Plan mode")
      expect(captured[1]).toContain("NO LONGER in Plan mode")
    }),
  )

  it.effect("re-injects the enter reminder after compaction while on the plan agent", () =>
    Effect.gen(function* () {
      const captured = yield* run([compactionEnded()], plan)
      yield* settle(captured, 1)
      expect(captured).toHaveLength(1)
      expect(captured[0]).toContain("You are in Plan mode")
    }),
  )

  it.effect("ignores compaction when the session is not on the plan agent", () =>
    Effect.gen(function* () {
      // The trailing switch to plan proves the earlier compaction event was processed.
      const captured = yield* run([compactionEnded(), agentSelected(plan, build)], build)
      yield* settle(captured, 1)
      expect(captured).toHaveLength(1)
      expect(captured[0]).toContain("You are in Plan mode")
    }),
  )
})
