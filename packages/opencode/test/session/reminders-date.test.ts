import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect } from "effect"
import type { Agent } from "../../src/agent/agent"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionReminders } from "@/session/reminders"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const root = LayerNode.group([
  Session.node,
  Database.node,
  EventV2Bridge.node,
  SessionProjector.node,
  FSUtil.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
])
const env = LayerNode.compile(root, [[RuntimeFlags.node, RuntimeFlags.layer({})]] as const)

const it = testEffect(env)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const DATE_SHAPE = /^<system-reminder>Today's date is (\d{4}-\d{2}-\d{2})<\/system-reminder>$/

function todayISO() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const matchDatePart = (part: SessionV1.Part): part is SessionV1.TextPart =>
  part.type === "text" && !part.ignored && Boolean(part.synthetic) && DATE_SHAPE.test(part.text)

const dateParts = (msg: SessionV1.WithParts) => msg.parts.filter(matchDatePart)

const storedDateParts = (messageID: MessageID) =>
  Effect.map(MessageV2.parts(messageID), (parts) => parts.filter(matchDatePart))

const seedUser = Effect.fn("test.seedUser")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const part = yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return { info: msg, parts: [part] } satisfies SessionV1.WithParts
})

const seedAssistant = Effect.fn("test.seedAssistant")(function* (input: {
  sessionID: SessionID
  parentID: MessageID
}) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: input.sessionID,
    mode: "build",
    agent: "build",
    parentID: input.parentID,
    path: { cwd: "/test", root: "/test" },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return { info: msg, parts: [] } satisfies SessionV1.WithParts
})

const seedSyntheticPart = Effect.fn("test.seedSyntheticPart")(function* (input: {
  msg: SessionV1.WithParts
  text: string
  ignored?: boolean
}) {
  const session = yield* Session.Service
  const part = yield* session.updatePart({
    id: PartID.ascending(),
    messageID: input.msg.info.id,
    sessionID: input.msg.info.sessionID,
    type: "text",
    text: input.text,
    synthetic: true,
    ...(input.ignored === undefined ? {} : { ignored: input.ignored }),
  })
  input.msg.parts.push(part)
  return part
})

it.live("injects today's date part exactly once per day", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({})
      const user = yield* seedUser(chat.id, "hello")
      const expected = `<system-reminder>Today's date is ${todayISO()}</system-reminder>`

      const result = yield* SessionReminders.apply({ messages: [user], agent: agent(), session: chat })

      const lastUser = result.findLast((msg) => msg.info.role === "user")
      expect(lastUser).toBeDefined()
      if (!lastUser) return
      const injected = dateParts(lastUser)
      expect(injected).toHaveLength(1)
      expect(injected[0].text).toBe(expected)
      expect(injected[0].messageID).toBe(lastUser.info.id)

      const stored = yield* storedDateParts(lastUser.info.id)
      expect(stored.map((part) => part.text)).toEqual([expected])

      const persistedBefore = yield* MessageV2.parts(lastUser.info.id)
      yield* SessionReminders.apply({ messages: result, agent: agent(), session: chat })
      expect(dateParts(lastUser)).toHaveLength(1)
      const persistedAfter = yield* MessageV2.parts(lastUser.info.id)
      expect(persistedAfter).toHaveLength(persistedBefore.length)
    }),
  ),
)

it.live("injects a fresh date part on the last user message when only a stale date exists", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({})
      const first = yield* seedUser(chat.id, "yesterday's question")
      yield* seedSyntheticPart({ msg: first, text: "<system-reminder>Today's date is 2020-01-01</system-reminder>" })
      const reply = yield* seedAssistant({ sessionID: chat.id, parentID: first.info.id })
      const second = yield* seedUser(chat.id, "today's question")

      const result = yield* SessionReminders.apply({
        messages: [first, reply, second],
        agent: agent(),
        session: chat,
      })
      const expected = `<system-reminder>Today's date is ${todayISO()}</system-reminder>`

      expect(dateParts(result[0]).map((part) => part.text)).toEqual([
        "<system-reminder>Today's date is 2020-01-01</system-reminder>",
      ])

      const lastUser = result.findLast((msg) => msg.info.role === "user")
      expect(lastUser?.info.id).toBe(second.info.id)
      expect(dateParts(lastUser!).map((part) => part.text)).toEqual([expected])

      const stored = yield* storedDateParts(second.info.id)
      expect(stored.map((part) => part.text)).toEqual([expected])
    }),
  ),
)

it.live("only a visible well-formed synthetic date part suppresses injection", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({})
      const today = todayISO()
      const reminder = `<system-reminder>Today's date is ${today}</system-reminder>`

      const user = yield* seedUser(chat.id, reminder)
      yield* seedSyntheticPart({ msg: user, text: reminder, ignored: true })
      yield* seedSyntheticPart({ msg: user, text: "<system-reminder>Today's date is 2026-9-7</system-reminder>" })
      yield* seedSyntheticPart({ msg: user, text: "<system-reminder>Today's date is not-a-date</system-reminder>" })
      yield* seedSyntheticPart({ msg: user, text: `${reminder} trailing text` })

      yield* SessionReminders.apply({ messages: [user], agent: agent(), session: chat })

      const injected = dateParts(user)
      expect(injected).toHaveLength(1)
      expect(injected[0].text).toBe(reminder)
      expect(Boolean(injected[0].ignored)).toBe(false)
    }),
  ),
)

it.live("no user message is a no-op", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({})
      const user = yield* seedUser(chat.id, "hello")
      const reply = yield* seedAssistant({ sessionID: chat.id, parentID: user.info.id })
      const messages = [reply]

      const result = yield* SessionReminders.apply({ messages, agent: agent(), session: chat })

      expect(result).toBe(messages)
      const stored = yield* MessageV2.parts(reply.info.id)
      expect(stored).toHaveLength(0)
    }),
  ),
)
