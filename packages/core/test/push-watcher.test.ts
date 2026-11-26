import { beforeEach, describe, expect } from "bun:test"
import { createECDH, createDecipheriv, hkdfSync } from "node:crypto"
import { DateTime, Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { PushCrypto } from "@opencode/core/push/crypto"
import { PushList } from "@opencode/core/push/list"
import { PushSender } from "@opencode/core/push/sender"
import { PushWatcher } from "@opencode/core/push/watcher"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Form } from "@opencode/schema/form"
import { Money } from "@opencode/schema/money"
import { Permission } from "@opencode/schema/permission"
import { Push } from "@opencode/schema/push"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionEvent } from "@opencode/schema/session-event"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { waitUntil } from "./lib/eventually"

let boxes: string[] = []
let silent: unknown[] = []

const relay = async (input: Request | string | URL, init?: RequestInit) => {
  const text = input instanceof Request ? await input.text() : String(init?.body)
  const body = JSON.parse(text)
  boxes.push(body.box)
  silent.push(body.silent)
  return new Response('{"status":"accepted"}', { status: 202 })
}

const parentID = Session.ID.make("ses_push_parent")
const childID = Session.ID.make("ses_push_child")
const grandchildID = Session.ID.make("ses_push_grandchild")
const messageID = SessionMessage.ID.create()

const session = (id: Session.ID, title: string, parent?: Session.ID) =>
  Session.Info.make({
    id,
    parentID: parent,
    projectID: Project.ID.global,
    title,
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: Location.Ref.make({ directory: AbsolutePath.make("/tmp/push") }),
  })

const sessions = new Map([
  [parentID, session(parentID, "Fix the login bug")],
  [childID, session(childID, "Look for the cause", parentID)],
  [grandchildID, session(grandchildID, "Read the logs", childID)],
])

const it = testEffect(
  LayerNode.compile(LayerNode.group([PushWatcher.node, PushSender.node, PushList.node, KV.node, Bus.node]), {
    replacements: [
      LayerNodePlatform.httpFetch.replace(LayerNodePlatform.fetchLayer(relay)),
      Session.node.replace(
        Layer.mock(Session.Service, {
          get: (id) => Effect.succeed(sessions.get(id)!),
          messages: () =>
            Effect.succeed([
              SessionMessage.Assistant.make({
                id: messageID,
                type: "assistant",
                agent: Agent.ID.make("build"),
                model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
                content: [
                  { type: "reasoning", text: "Check the session code", time: { created: DateTime.makeUnsafe(0) } },
                  { type: "text", text: "Fixed the login bug." },
                ],
                time: { created: DateTime.makeUnsafe(0) },
              }),
            ]),
          revert: {
            stage: () => Effect.die(new Error("unused")),
            clear: () => Effect.die(new Error("unused")),
            commit: () => Effect.die(new Error("unused")),
          },
        }),
      ),
    ],
  }),
)

const id = "00000000-0000-4000-8000-000000000001"

const phone = Effect.fn(function* () {
  const list = yield* PushList.Service
  const keys = createECDH("prime256v1")
  keys.generateKeys()
  const registered = yield* list.register(Push.DeviceID.make(id), {
    callbackURL: `${PushList.relays[0]}/v2/notify/ok`,
    expiresAt: Date.now() + 86_400_000,
    publicKey: keys.getPublicKey("base64"),
    platform: "android",
    name: "Pixel",
  })
  const shared = keys.computeSecret(Buffer.from(registered.publicKey, "base64"))
  return Buffer.from(hkdfSync("sha256", shared, Buffer.from(id, "utf8"), PushCrypto.context, 32))
})

const open = (key: Buffer, box: string) => {
  const bytes = Buffer.from(box, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12))
  decipher.setAAD(Buffer.from(`${PushCrypto.context}:${id}`, "utf8"))
  decipher.setAuthTag(bytes.subarray(bytes.length - 16))
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString(),
  )
}

const step = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID: SessionMessage.ID.create(),
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
      started: 0,
    })
  })

beforeEach(() => {
  boxes = []
  silent = []
})

describe("PushWatcher", () => {
  it.live("notifies when a top-level session finishes a model turn or fails", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const key = yield* phone()

      yield* step(childID)
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: childID })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
      yield* step(parentID)
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: parentID, reason: "user" })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
      yield* step(parentID)
      const succeeded = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
      yield* waitUntil(Effect.sync(() => boxes.length === 1))
      const failed = yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: parentID,
        error: { type: "provider.rate-limit", message: "x", status: 429, retryAfterMs: 30_000 },
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 2))

      expect(boxes.map((box) => open(key, box))).toEqual([
        {
          v: 1,
          type: "turn",
          id: parentID,
          time: succeeded.created,
          sessionID: parentID,
          directory: "/tmp/push",
          title: "Fix the login bug",
          body: "Finished",
          data: {
            outcome: "succeeded",
            messageID,
            idleMessageID: SessionMessage.ID.fromEvent(succeeded.id),
            text: "Fixed the login bug.",
          },
        },
        {
          v: 1,
          type: "turn",
          id: parentID,
          time: failed.created,
          sessionID: parentID,
          directory: "/tmp/push",
          title: "Fix the login bug",
          body: "Failed",
          data: {
            outcome: "failed",
            idleMessageID: SessionMessage.ID.fromEvent(failed.id),
            error: { type: "provider.rate-limit", message: "x", status: 429, retryAfterMs: 30_000 },
          },
        },
      ])
    }),
  )

  it.live("asks for questions and permissions, also from subagents, under the top-level session", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const key = yield* phone()
      const form = (id: string, sessionID: string, kind: string): Form.Info => ({
        id: Form.ID.make(id),
        sessionID,
        title: "Questions",
        metadata: { kind, tool: { messageID: "msg_1", id: "call_1" } },
        fields: [
          {
            key: "q0",
            title: "Database",
            description: "Which database?",
            type: "string",
            options: [
              { value: "Postgres", label: "Postgres", description: "The production database" },
              { value: "sqlite", label: "SQLite" },
            ],
            custom: true,
          },
          { key: "q1", title: "Seed", type: "boolean" },
        ],
      })

      yield* bus.publish(Form.Event.Created, { form: form("frm_other", childID, "elicitation") })
      yield* bus.publish(Form.Event.Created, { form: form("frm_global", "global", "question") })
      const created = yield* bus.publish(Form.Event.Created, { form: form("frm_1", grandchildID, "question") })
      yield* waitUntil(Effect.sync(() => boxes.length === 1))
      const asked = yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.make("per_1"),
        sessionID: childID,
        action: "bash",
        resources: ["git push"],
        save: ["git push *"],
        source: { type: "tool", messageID: "msg_2", id: "call_2" },
        message: "Pushes to main",
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 2))

      expect(boxes.map((box) => open(key, box))).toEqual([
        {
          v: 1,
          type: "form",
          id: "frm_1",
          time: created.created,
          sessionID: parentID,
          directory: "/tmp/push",
          attention: true,
          title: "Fix the login bug",
          body: "Which database?",
          data: {
            formID: "frm_1",
            replySessionID: grandchildID,
            kind: "question",
            count: 2,
            source: { type: "tool", messageID: "msg_1", id: "call_1" },
            fields: [
              {
                key: "q0",
                type: "string",
                title: "Database",
                description: "Which database?",
                custom: true,
                options: [
                  { label: "Postgres", description: "The production database" },
                  { label: "SQLite", value: "sqlite" },
                ],
              },
            ],
          },
        },
        {
          v: 1,
          type: "permission",
          id: "per_1",
          time: asked.created,
          sessionID: parentID,
          directory: "/tmp/push",
          attention: true,
          title: "Fix the login bug",
          body: "Needs permission: bash",
          data: {
            requestID: "per_1",
            replySessionID: childID,
            action: "bash",
            resources: ["git push"],
            save: ["git push *"],
            decisions: ["once", "always", "reject"],
            message: "Pushes to main",
            source: { type: "tool", messageID: "msg_2", id: "call_2" },
          },
        },
      ])
    }),
  )
  it.live("clears a notification once it is answered, interrupted or followed by a new prompt", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const key = yield* phone()
      const cleared = () => boxes.filter((_, index) => silent[index] === true).map((box) => open(key, box))
      const ask = (id: string) =>
        bus.publish(Permission.Event.Asked, {
          id: Permission.ID.make(id),
          sessionID: childID,
          action: "bash",
          resources: ["git push"],
        })
      const prompt = (type: "user" | "synthetic") =>
        bus.publish(SessionEvent.InboxEnqueued, {
          sessionID: parentID,
          inboxID: SessionMessage.ID.create(),
          item: { type, payload: { text: "Next" }, delivery: "steer" },
        })

      // Nothing was sent for these, so nothing is cleared.
      yield* bus.publish(Permission.Event.Replied, {
        sessionID: childID,
        requestID: Permission.ID.make("per_unknown"),
        reply: "once",
      })
      yield* prompt("user")

      yield* ask("per_1")
      yield* waitUntil(Effect.sync(() => boxes.length === 1))
      // Nothing to save, so "always" isn't offered.
      expect(open(key, boxes[0]!).data.decisions).toEqual(["once", "reject"])
      const replied = yield* bus.publish(Permission.Event.Replied, {
        sessionID: childID,
        requestID: Permission.ID.make("per_1"),
        reply: "once",
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 2))

      yield* bus.publish(Form.Event.Created, {
        form: {
          id: Form.ID.make("frm_1"),
          sessionID: childID,
          title: "Questions",
          metadata: { kind: "question" },
          fields: [{ key: "q0", title: "Database", type: "string", custom: true }],
        },
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 3))
      // A form with one field can be answered from the notification.
      expect(open(key, boxes[2]!).data).toEqual({
        formID: "frm_1",
        replySessionID: childID,
        kind: "question",
        count: 1,
        inlineReply: true,
        fields: [{ key: "q0", type: "string", title: "Database", custom: true }],
      })
      const cancelled = yield* bus.publish(Form.Event.Cancelled, { id: Form.ID.make("frm_1"), sessionID: childID })
      yield* waitUntil(Effect.sync(() => boxes.length === 4))

      // An interrupted request gets no reply.
      yield* ask("per_2")
      yield* waitUntil(Effect.sync(() => boxes.length === 5))
      const interrupted = yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: childID, reason: "user" })
      yield* waitUntil(Effect.sync(() => boxes.length === 6))

      yield* step(parentID)
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
      yield* waitUntil(Effect.sync(() => boxes.length === 7))
      yield* prompt("synthetic")
      const prompted = yield* prompt("user")
      yield* waitUntil(Effect.sync(() => boxes.length === 8))

      // Archiving or deleting the session removes whatever is still showing for it.
      for (const gone of [SessionEvent.Archived, SessionEvent.Deleted]) {
        const before = boxes.length
        yield* ask("per_3")
        yield* step(parentID)
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
        yield* waitUntil(Effect.sync(() => boxes.length === before + 2))
        yield* bus.publish(gone, { sessionID: parentID })
        yield* waitUntil(Effect.sync(() => boxes.length === before + 4))
        expect(
          cleared()
            .slice(-2)
            .map((item) => item.ids[0])
            .sort(),
        ).toEqual([parentID, "per_3"].sort())
      }

      expect(silent.slice(0, 8)).toEqual([undefined, true, undefined, true, undefined, true, undefined, true])
      expect(cleared().slice(0, 4)).toEqual([
        { v: 1, type: "clear", ids: ["per_1"], time: replied.created },
        { v: 1, type: "clear", ids: ["frm_1"], time: cancelled.created },
        { v: 1, type: "clear", ids: ["per_2"], time: interrupted.created },
        { v: 1, type: "clear", ids: [parentID], time: prompted.created },
      ])
    }),
  )

  it.live("clears a finished turn once it is viewed, but not by a view reported as the turn ends", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const key = yield* phone()

      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.make("per_1"),
        sessionID: parentID,
        action: "bash",
        resources: ["git push"],
      })
      yield* step(parentID)
      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: parentID,
        error: { type: "unknown", message: "x" },
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 3))
      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.make("per_2"),
        sessionID: parentID,
        action: "bash",
        resources: ["git push"],
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 4))

      // The session was open when the turn ended, so nobody has necessarily seen it.
      yield* bus.publish(SessionEvent.Viewed, { sessionID: parentID, idle: Date.now() })
      yield* bus.publish(Permission.Event.Replied, {
        sessionID: parentID,
        requestID: Permission.ID.make("per_2"),
        reply: "once",
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 5))
      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.make("per_3"),
        sessionID: parentID,
        action: "bash",
        resources: ["git push"],
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 6))
      yield* bus.publish(SessionEvent.Viewed, { sessionID: parentID, idle: Date.now() - 60_000 })
      yield* waitUntil(Effect.sync(() => boxes.length === 7))

      // A view never clears a pending permission: only its answer does.
      expect(
        boxes
          .slice(3)
          .map((box) => open(key, box))
          .map((item) => [item.type, item.id ?? item.ids[0]]),
      ).toEqual([
        ["permission", "per_2"],
        ["clear", "per_2"],
        ["permission", "per_3"],
        ["clear", parentID],
      ])
    }),
  )
})
