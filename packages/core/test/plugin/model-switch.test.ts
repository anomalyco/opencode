import { describe, expect } from "bun:test"
import { Message } from "@opencode/ai"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { DateTime, Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { ModelSwitchPlugin } from "@opencode/core/plugin/model-switch"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Money } from "@opencode/schema/money"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_model_switch_test")
const provider = Provider.ID.make("test")
const gpt = { providerID: provider, id: Model.ID.make("gpt-6-luna") }
const claude = { providerID: provider, id: Model.ID.make("claude-fable-5-1") }
const glm = { providerID: provider, id: Model.ID.make("glm-5.3-flash") }
const at = DateTime.makeUnsafe(0)

const patchNotice = [
  "<system-reminder>",
  "You are continuing a conversation started by a different model. Some tools it used are not available to you. `patch` is no longer available and must not be called; use `edit` and `write` instead.",
  "</system-reminder>",
].join("\n")

const editNotice = [
  "<system-reminder>",
  "You are continuing a conversation started by a different model. Some tools it used are not available to you. `edit` and `write` are no longer available and must not be called; use `patch` instead.",
  "</system-reminder>",
].join("\n")

/** One assistant turn in the durable history, with the tools it called. */
const turn = (id: string, model: Model.Ref, tools: ReadonlyArray<string>) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model,
    content: tools.map((name, index) => ({
      type: "tool",
      id: `call_${id}_${index}`,
      name,
      state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
      time: { created: at, completed: at },
    })),
    cost: Money.USD.make(0),
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: at, completed: at },
  })

/** A reminder this plugin persisted earlier. */
const reminder = (id: string, removed: ReadonlyArray<string>) =>
  SessionMessage.Synthetic.make({
    id: SessionMessage.ID.make(id),
    type: "synthetic",
    text: "earlier reminder",
    metadata: { "opencode.model-switch": removed },
    time: { created: at },
  })

/** The same history as the model sees it: one tool call per name, plus the user's new prompt. */
const lowered = (history: ReadonlyArray<SessionMessage.Info>) => [
  ...history.flatMap((message) =>
    message.type === "assistant"
      ? [
          Message.assistant(
            message.content.flatMap((part) =>
              part.type === "tool" ? [{ type: "tool-call" as const, id: part.id, name: part.name, input: {} }] : [],
            ),
          ),
        ]
      : [],
  ),
  Message.user("Can you also add a --version flag?"),
]

/** Runs one request through the hook; returns the request messages after it and anything persisted. */
const request = Effect.fnUntraced(function* (
  model: Model.Ref,
  tools: ReadonlyArray<string>,
  history: ReadonlyArray<SessionMessage.Info>,
) {
  const persisted = new Array<{ text: string; metadata?: Record<string, unknown>; resume?: boolean }>()
  let hook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  yield* ModelSwitchPlugin.Plugin.effect(
    host({
      session: {
        hook: (name, callback) => {
          if (name === "context") hook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
        context: () => Effect.succeed(history),
        synthetic: (input) => {
          persisted.push({ text: input.text, metadata: input.metadata, resume: input.resume })
          return Effect.succeed(
            SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_model_switch_test"),
              sessionID,
              time: { created: at },
              type: "synthetic",
              payload: { text: input.text },
              delivery: "steer",
            }),
          )
        },
      },
    }),
  )
  if (!hook) return yield* Effect.die("model switch plugin did not register a context hook")
  const event: SessionContext = {
    sessionID,
    agent: Agent.ID.make("build"),
    model,
    system: [],
    messages: lowered(history),
    tools: Object.fromEntries(tools.map((name) => [name, { description: name, input: { type: "object" } }])),
    options: {},
  }
  yield* hook(event)
  const injected = event.messages.flatMap((message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    return part?.type === "text" && part.text.startsWith("<system-reminder>") ? [part.text] : []
  })
  return { injected, persisted, last: event.messages.at(-1) }
})

describe("ModelSwitchPlugin", () => {
  it.effect("reminds a model that lacks patch when another model's turns called it", () =>
    Effect.gen(function* () {
      const result = yield* request(
        claude,
        ["read", "glob", "edit", "write"],
        [turn("msg_1", gpt, ["read", "patch"]), turn("msg_2", gpt, ["patch", "glob"])],
      )
      expect(result.injected).toEqual([patchNotice])
      expect(result.last?.role).toBe("user")
      expect(result.persisted).toEqual([
        { text: patchNotice, metadata: { "opencode.model-switch": ["patch"] }, resume: false },
      ])
    }),
  )

  it.effect("reminds a model that lacks edit and write, with singular phrasing for one tool", () =>
    Effect.gen(function* () {
      const both = yield* request(gpt, ["read", "patch"], [turn("msg_1", claude, ["edit", "write", "read"])])
      expect(both.injected).toEqual([editNotice])

      const editOnly = yield* request(gpt, ["read", "patch"], [turn("msg_1", claude, ["edit"])])
      expect(editOnly.injected[0]).toContain(
        "`edit` is no longer available and must not be called; use `patch` instead.",
      )
    }),
  )

  it.effect("only suggests replacements this request actually offers", () =>
    Effect.gen(function* () {
      const result = yield* request(claude, ["read"], [turn("msg_1", gpt, ["patch"])])
      expect(result.injected[0]).toContain("`patch` is no longer available and must not be called.")
      expect(result.injected[0]).not.toContain("instead")
    }),
  )

  it.effect("stays silent when nothing in the history is missing from this request", () =>
    Effect.gen(function* () {
      // Same tools on both sides of the switch.
      expect((yield* request(glm, ["edit", "write"], [turn("msg_1", claude, ["edit", "write"])])).injected).toEqual([])
      // Only read-only tools were used before the switch.
      expect(
        (yield* request(claude, ["read", "grep", "glob", "edit"], [turn("msg_1", gpt, ["read", "grep", "glob"])]))
          .injected,
      ).toEqual([])
      // The same model made the calls; a missing tool here is not a model switch.
      expect((yield* request(claude, ["read"], [turn("msg_1", claude, ["edit"])])).injected).toEqual([])
    }),
  )

  it.effect("does not repeat a reminder that already covers the missing tools", () =>
    Effect.gen(function* () {
      // GPT wrote with patch, a first non-GPT model was reminded, now a second non-GPT model takes over.
      const covered = yield* request(
        glm,
        ["read", "edit", "write"],
        [turn("msg_1", gpt, ["patch"]), reminder("msg_2", ["patch"]), turn("msg_3", claude, ["edit"])],
      )
      expect(covered.injected).toEqual([])
      expect(covered.persisted).toEqual([])

      // Switching back to GPT: the last reminder was about patch, so the edit calls still need one.
      const back = yield* request(
        gpt,
        ["read", "patch"],
        [turn("msg_1", gpt, ["patch"]), reminder("msg_2", ["patch"]), turn("msg_3", claude, ["edit"])],
      )
      expect(back.injected).toEqual([editNotice.replace("`edit` and `write` are", "`edit` is")])
    }),
  )
})
