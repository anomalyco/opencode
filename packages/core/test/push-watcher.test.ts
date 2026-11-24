import { beforeEach, describe, expect } from "bun:test"
import { createECDH, createDecipheriv, hkdfSync } from "node:crypto"
import { DateTime, Effect, Layer } from "effect"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { PushCrypto } from "@opencode/core/push/crypto"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { PushSender } from "@opencode/core/push/sender"
import { PushWatcher } from "@opencode/core/push/watcher"
import { Session } from "@opencode/core/session"
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

const relay = async (input: Request | string | URL, init?: RequestInit) => {
  const text = input instanceof Request ? await input.text() : String(init?.body)
  boxes.push(JSON.parse(text).box)
  return new Response('{"status":"accepted"}', { status: 202 })
}

const parentID = Session.ID.make("ses_push_parent")
const childID = Session.ID.make("ses_push_child")
const grandchildID = Session.ID.make("ses_push_grandchild")

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
      PushOptions.node.replace(
        Layer.succeed(
          PushOptions.Service,
          PushOptions.Service.of({
            get: () => Effect.succeed({ enabled: true, relays: [PushOptions.defaultRelay] }),
          }),
        ),
      ),
      Session.node.replace(
        Layer.mock(Session.Service, {
          get: (id) => Effect.succeed(sessions.get(id)!),
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
  const registered = yield* list.register(
    Push.DeviceID.make(id),
    {
      callbackURL: `${PushOptions.defaultRelay}/v2/notify/ok`,
      expiresAt: Date.now() + 86_400_000,
      publicKey: keys.getPublicKey("base64"),
      platform: "android",
      name: "Pixel",
    },
    [PushOptions.defaultRelay],
  )
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

beforeEach(() => {
  boxes = []
})

describe("PushWatcher", () => {
  it.live("notifies when a top-level session finishes, fails or stops for inactivity", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const key = yield* phone()

      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: childID })
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: parentID, reason: "user" })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parentID })
      yield* waitUntil(Effect.sync(() => boxes.length === 1))
      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: parentID,
        error: { type: "unknown", message: "x" },
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 2))
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: parentID, reason: "inactivity" })
      yield* waitUntil(Effect.sync(() => boxes.length === 3))

      expect(boxes.map((box) => open(key, box))).toEqual([
        {
          v: 1,
          type: "session.idle",
          sessionID: parentID,
          title: "Fix the login bug",
          body: "Finished",
          data: { outcome: "succeeded" },
        },
        {
          v: 1,
          type: "session.idle",
          sessionID: parentID,
          title: "Fix the login bug",
          body: "Failed",
          data: { outcome: "failed" },
        },
        {
          v: 1,
          type: "session.idle",
          sessionID: parentID,
          title: "Fix the login bug",
          body: "Stopped",
          data: { outcome: "interrupted" },
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
        metadata: { kind },
        fields: [{ key: "q0", title: "Database", description: "Which database?", type: "string" }],
      })

      yield* bus.publish(Form.Event.Created, { form: form("frm_other", childID, "elicitation") })
      yield* bus.publish(Form.Event.Created, { form: form("frm_global", "global", "question") })
      yield* bus.publish(Form.Event.Created, { form: form("frm_1", grandchildID, "question") })
      yield* waitUntil(Effect.sync(() => boxes.length === 1))
      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.make("per_1"),
        sessionID: childID,
        action: "bash",
        resources: ["git push"],
      })
      yield* waitUntil(Effect.sync(() => boxes.length === 2))

      expect(boxes.map((box) => open(key, box))).toEqual([
        {
          v: 1,
          type: "question",
          sessionID: parentID,
          title: "Fix the login bug",
          body: "Which database?",
          data: { formID: "frm_1" },
        },
        {
          v: 1,
          type: "permission",
          sessionID: parentID,
          title: "Fix the login bug",
          body: "Needs permission: bash",
          data: { requestID: "per_1", action: "bash" },
        },
      ])
    }),
  )
})
