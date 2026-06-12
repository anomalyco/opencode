import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { InstanceState } from "../../src/effect/instance-state"
import { SessionReminders } from "../../src/session/reminders"
import { Session } from "../../src/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    FSUtil.defaultLayer,
    Layer.mock(Session.Service)({
      updatePart: (part) => Effect.succeed(part),
    }),
  ),
)

describe("SessionReminders", () => {
  it.instance("uses custom plan reminders outside experimental plan mode", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const session = sessionInfo(test.directory)
      const ctx = yield* InstanceState.context
      const result = yield* SessionReminders.apply({
        messages: [userMessage(session.id)],
        agent: planAgent({ planReminder: "Custom plan reminder\n${planInfo}" }),
        session,
      }).pipe(Effect.provide(RuntimeFlags.layer()))

      expect(textPart(result)).toBe(
        [
          "Custom plan reminder",
          `No plan file exists yet. You should create your plan at ${Session.plan(session, ctx)} using the write tool.`,
        ].join("\n"),
      )
    }),
    { git: true },
  )

  it.instance("falls back to the built-in experimental plan reminder", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const session = sessionInfo(test.directory)
      const ctx = yield* InstanceState.context
      const result = yield* SessionReminders.apply({
        messages: [userMessage(session.id)],
        agent: planAgent(),
        session,
      }).pipe(Effect.provide(RuntimeFlags.layer({ experimentalPlanMode: true })))

      expect(textPart(result)).toContain("Plan mode is active.")
      expect(textPart(result)).toContain(`No plan file exists yet. You should create your plan at ${Session.plan(session, ctx)} using the write tool.`)
    }),
    { git: true },
  )

  it.instance("uses custom build switch reminders in experimental plan mode", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const session = sessionInfo(test.directory)
      const ctx = yield* InstanceState.context
      const plan = Session.plan(session, ctx)

      yield* FSUtil.use.writeWithDirs(plan, "# existing plan")

      const result = yield* SessionReminders.apply({
        messages: [userMessage(session.id), assistantMessage(session.id, "plan")],
        agent: buildAgent({ buildSwitchReminder: "Custom build reminder\n${planInfo}" }),
        session,
      }).pipe(Effect.provide(RuntimeFlags.layer({ experimentalPlanMode: true })))

      expect(textPart(result)).toBe(
        [
          "Custom build reminder",
          `A plan file exists at ${plan}. You should execute on the plan defined within it`,
        ].join("\n"),
      )
    }),
    { git: true },
  )
})

function sessionInfo(directory: string): Session.Info {
  return {
    id: SessionID.make("ses_reminders"),
    slug: "reminders",
    projectID: ProjectV2.ID.make("project_reminders"),
    directory,
    title: "Reminders",
    version: "1",
    time: {
      created: 123,
      updated: 123,
    },
  }
}

function userMessage(sessionID: SessionID): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.make("msg_user_reminders"),
      role: "user",
      sessionID,
      time: { created: 123 },
      agent: "build",
      model: {
        providerID: ProviderV2.ID.make("openrouter"),
        modelID: ModelV2.ID.make("openai/gpt-5"),
      },
    },
    parts: [],
  }
}

function assistantMessage(sessionID: SessionID, agent: string): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.make("msg_assistant_reminders"),
      role: "assistant",
      sessionID,
      time: { created: 124 },
      parentID: MessageID.make("msg_user_reminders"),
      modelID: ModelV2.ID.make("openai/gpt-5"),
      providerID: ProviderV2.ID.make("openrouter"),
      mode: agent,
      agent,
      path: {
        cwd: ".",
        root: ".",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    },
    parts: [],
  }
}

function planAgent(overrides: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name: "plan",
    mode: "primary",
    permission: [],
    options: {},
    ...overrides,
  }
}

function buildAgent(overrides: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    permission: [],
    options: {},
    ...overrides,
  }
}

function textPart(messages: SessionV1.WithParts[]) {
  const user = messages.find((message) => message.info.role === "user")
  const part = user?.parts.findLast((item) => item.type === "text")
  if (!part || part.type !== "text") throw new Error("expected injected text reminder")
  return part.text
}
