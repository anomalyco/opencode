import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai/effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { MessageContext } from "@opencode/core/session/message-context"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRecentText } from "@opencode/core/session/recent-text"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { testEffect } from "./lib/effect"

const created = DateTime.makeUnsafe(0)
const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
const senderID = SessionSchema.ID.make("ses_context_sender")
const receiverID = SessionSchema.ID.make("ses_context_receiver")
const ORIGIN = MessageContext.ORIGIN

const user = (text: string, metadata?: Record<string, unknown>) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.make("msg_context_user"),
    type: "user",
    text,
    metadata,
    time: { created },
  })

const fromSender = { [ORIGIN]: { from: `session:${senderID}` } }
const senderLine = `<message-origin from="session:${senderID}"/>`

describe("MessageContext.format", () => {
  test("renders from, via and actor as IDs", () => {
    expect(MessageContext.format(fromSender)).toBe(senderLine)
    expect(MessageContext.format({ [ORIGIN]: { from: "schedule:sch_1" } })).toBe(
      `<message-origin from="schedule:sch_1"/>`,
    )
    expect(MessageContext.format({ [ORIGIN]: { via: "voice:ios" } })).toBe(`<message-origin via="voice:ios"/>`)
    expect(MessageContext.format({ [ORIGIN]: { via: "seer", actor: "slack:U123" } })).toBe(
      `<message-origin via="seer" actor="slack:U123"/>`,
    )
    expect(MessageContext.format({ [ORIGIN]: { from: "tool:ios-train", actor: "agent:a1" } })).toBe(
      `<message-origin from="tool:ios-train" actor="agent:a1"/>`,
    )
  })

  test("builds origins for sessions, schedules and commands", () => {
    expect(MessageContext.fromSession(senderID)).toEqual(fromSender)
    expect(MessageContext.fromSchedule("sch_1")).toEqual({ [ORIGIN]: { from: "schedule:sch_1" } })
    expect(MessageContext.viaCommand("review")).toEqual({ [ORIGIN]: { via: "command:review" } })
  })

  test("escapes attribute values", () => {
    expect(MessageContext.format({ [ORIGIN]: { from: `tool:"<b>" & more` } })).toBe(
      `<message-origin from="tool:&quot;&lt;b&gt;&quot; &amp; more"/>`,
    )
    expect(MessageContext.format({ [ORIGIN]: { via: "seer", actor: `a"/><x` } })).toBe(
      `<message-origin via="seer" actor="a&quot;/&gt;&lt;x"/>`,
    )
  })

  test("renders nothing for metadata without an origin or one that doesn't decode", () => {
    expect(MessageContext.format(undefined)).toBe("")
    expect(MessageContext.format({ source: "api" })).toBe("")
    for (const value of [
      "session:ses_context_sender",
      // from and via together
      { from: "session:ses_1", via: "voice:ios" },
      // not one trimmed, non-empty line of at most 200 characters
      { from: "" },
      { from: " tool:x" },
      { via: "voice:ios\n" },
      { from: "tool:a\nb" },
      { via: "seer", actor: "a\rb" },
      { from: "x".repeat(201) },
      // the shape before from/via
      { kind: "session", sessionID: "ses_1" },
      { actor: "slack:U1" },
      null,
    ])
      expect(MessageContext.format({ [ORIGIN]: value })).toBe("")
    expect(MessageContext.format({ [ORIGIN]: { from: "x".repeat(200) } })).toBe(
      `<message-origin from="${"x".repeat(200)}"/>`,
    )
  })
})

describe("prompt builders", () => {
  test("toLLMMessages puts the origin line before the text the person typed", () => {
    expect(toLLMMessages([user("rebase the PRs", fromSender)], model)[0]?.content).toEqual([
      Message.text(`${senderLine}\nrebase the PRs`),
    ])
    expect(toLLMMessages([user("", fromSender)], model)[0]?.content).toEqual([Message.text(senderLine)])
  })

  test("toLLMMessages output is unchanged without an origin", () => {
    expect(toLLMMessages([user("rebase the PRs", { source: "api" })], model)[0]?.content).toEqual([
      Message.text("rebase the PRs"),
    ])
  })

  test("compaction's recent text labels only the person's messages [User]", () => {
    expect(SessionRecentText.messageToText(user("typed"))).toBe("[User]: typed")
    expect(SessionRecentText.messageToText(user("spoken", { [ORIGIN]: { via: "voice:ios" } }))).toBe(
      `[User]: <message-origin via="voice:ios"/>\nspoken`,
    )
    expect(SessionRecentText.messageToText(user("rebase the PRs", fromSender))).toBe(
      `[Message]: ${senderLine}\nrebase the PRs`,
    )
    expect(SessionRecentText.messageToText(user("hourly", MessageContext.fromSchedule("sch_1")))).toBe(
      `[Message]: <message-origin from="schedule:sch_1"/>\nhourly`,
    )
    expect(SessionRecentText.messageToText(user("lgtm", { [ORIGIN]: { via: "seer", actor: "slack:U1" } }))).toBe(
      `[Message]: <message-origin via="seer" actor="slack:U1"/>\nlgtm`,
    )
  })
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, SessionStore.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const flag = (message_context: boolean) =>
  Config.testLayer([
    new Document({
      type: "document",
      info: new Info({ experimental: new ConfigExperimental.Info({ message_context }) }),
    }),
  ])

const setup = (title?: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const bus = yield* Bus.Service
    const inbox = yield* SessionInbox.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    for (const [sessionID, slug] of [
      [senderID, "sender"],
      [receiverID, "receiver"],
    ] as const)
      yield* bus.publish(SessionEvent.Created, {
        sessionID,
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make("/project") },
        slug,
        ...(sessionID === senderID && title !== undefined ? { title } : {}),
        version: "test",
      })
    const prompt = Effect.fnUntraced(function* (text: string, metadata?: Record<string, unknown>) {
      const id = SessionMessage.ID.create()
      yield* inbox.admit({
        id,
        sessionID: receiverID,
        item: { type: "user", payload: { text, metadata }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: receiverID, inboxID: id })
      return id
    })
    const texts = (enabled: boolean) =>
      SessionHistory.loadForModel(db, receiverID, "local").pipe(
        Effect.provide(flag(enabled)),
        Effect.map((history) =>
          toLLMMessages(history, model).flatMap((message) =>
            message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
          ),
        ),
      )
    return { db, bus, prompt, texts }
  })

describe("SessionHistory message context", () => {
  it.effect("model reads drop the key with the flag off, so the request matches a message without it", () =>
    Effect.gen(function* () {
      const s = yield* setup("Fix login")
      yield* s.prompt("hello", fromSender)
      for (const history of [
        yield* SessionHistory.loadForModel(s.db, receiverID, "local").pipe(Effect.provide(flag(false))),
        // Without any Config in scope the flag is off too.
        yield* SessionHistory.loadForModel(s.db, receiverID, "local"),
      ]) {
        const [message] = history
        if (message?.type !== "user") return yield* Effect.die("Expected a user message")
        expect(message.metadata).toEqual({})
        const { metadata: _, ...plain } = message
        expect(toLLMMessages(history, model)).toEqual(toLLMMessages([plain], model))
      }
    }),
  )

  it.effect("stored reads return metadata as stored whatever the flag", () =>
    Effect.gen(function* () {
      const s = yield* setup("Fix login")
      const store = yield* SessionStore.Service
      const origin = { from: `session:${senderID}` }
      yield* s.prompt("hello", { [ORIGIN]: origin, source: "api" })
      for (const messages of [
        yield* store.context(receiverID),
        yield* store.context(receiverID).pipe(Effect.provide(flag(false))),
        yield* SessionHistory.load(s.db, receiverID, "latest").pipe(Effect.provide(flag(true))),
      ])
        expect(messages.map((message) => message.metadata)).toEqual([{ [ORIGIN]: origin, source: "api" }])
    }),
  )

  it.effect("with the flag on, renders the stored IDs, which never change after the message is sent", () =>
    Effect.gen(function* () {
      const s = yield* setup("Fix login")
      yield* s.prompt("hello", fromSender)
      yield* s.prompt("release is out", { [ORIGIN]: { from: "tool:ios-train" } })
      yield* s.prompt("spoken", { [ORIGIN]: { via: "voice:ios" } })
      yield* s.prompt("typed by a person")
      const expected = [
        `${senderLine}\nhello`,
        `<message-origin from="tool:ios-train"/>\nrelease is out`,
        `<message-origin via="voice:ios"/>\nspoken`,
        "typed by a person",
      ]
      expect(yield* s.texts(true)).toEqual(expected)
      // Renaming or deleting the sender leaves earlier lines alone, so the receiver's prompt cache holds.
      yield* s.bus.publish(SessionEvent.Renamed, { sessionID: senderID, title: "Login fixes" })
      expect(yield* s.texts(true)).toEqual(expected)
      yield* s.db.delete(SessionTable).where(eq(SessionTable.id, senderID)).run()
      expect(yield* s.texts(true)).toEqual(expected)
      expect(yield* s.texts(false)).toEqual(["hello", "release is out", "spoken", "typed by a person"])
    }),
  )

  it.effect("leaves a value that doesn't decode unrendered", () =>
    Effect.gen(function* () {
      const s = yield* setup()
      yield* s.prompt("hello", { [ORIGIN]: { from: "session:ses_1", via: "voice:ios" } })
      yield* s.prompt("again", { [ORIGIN]: { kind: "session", sessionID: senderID } })
      expect(yield* s.texts(true)).toEqual(["hello", "again"])
    }),
  )

  it.effect("builds a compaction's recent text from the origin, as the flag configures", () =>
    Effect.gen(function* () {
      const s = yield* setup("Fix login")
      const keepID = yield* s.prompt("kept", fromSender)
      yield* s.bus.publish(
        SessionEvent.Compaction.Ended,
        { sessionID: receiverID, reason: "manual", model, text: "summary" },
        { metadata: { keepID } },
      )
      const recent = (enabled: boolean) =>
        SessionHistory.loadForModel(s.db, receiverID, "latest").pipe(
          Effect.provide(flag(enabled)),
          Effect.map((history) => {
            const compaction = history[0]
            return compaction?.type === "compaction" && compaction.status === "completed"
              ? SessionRecentText.kept(compaction)
              : undefined
          }),
        )
      expect(yield* recent(true)).toBe(`[Message]: ${senderLine}\nkept`)
      expect(yield* recent(false)).toBe("[User]: kept")
    }),
  )
})
