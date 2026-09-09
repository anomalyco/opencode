import { expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { fileURLToPath } from "node:url"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { DSH } from "@/session/dsh"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Permission } from "@/permission"
import { MessageID } from "@/session/schema"
import { pollWithTimeout, testEffect } from "../lib/effect"

const fixture = fileURLToPath(new URL("../fixture/dsh-acp.ts", import.meta.url))
const config = {
  backend: {
    type: "dsh" as const,
    command: [process.execPath, fixture, "early-config"],
    models: [
      { key: "deepseek-official/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { key: "deepseek-official/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ],
    default_model: "deepseek-official/deepseek-v4-flash",
    startup_timeout: 10000,
    shutdown_timeout: 500,
  },
}
const it = testEffect(AppNodeBuilder.build(LayerNode.group([
  DSH.node, Session.node, SessionStatus.node, SessionRunState.node, Permission.node, SessionProjector.node, InstanceStore.node,
]), [
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  [InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))],
]))

it.instance("does not select DSH for native sessions", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const created = yield* session.create({})
  expect(yield* dsh.selected(created.id)).toBe(false)
}))

it.instance("records native message parts and resumes the same DSH session across processes", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const status = yield* SessionStatus.Service
  const created = yield* session.create({})
  const first = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "hello" }] })
  expect(first.info.role === "assistant" && first.info.error).toBeUndefined()
  expect(first.parts).toContainEqual(expect.objectContaining({ type: "text", text: "turn 1: finished" }))
  const saved = yield* session.get(created.id)
  expect(saved.metadata?.dsh.sessionId).toBeString()
  const second = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "follow-up" }] })
  expect(second.parts).toContainEqual(expect.objectContaining({ type: "text", text: "turn 2: finished" }))
  expect((yield* session.get(created.id)).metadata?.dsh).toEqual(saved.metadata?.dsh)
  expect((yield* session.messages({ sessionID: created.id })).length).toBe(4)
  expect((yield* status.get(created.id)).type).toBe("idle")
}), { config }, 30000)

it.instance("switches the DSH model for the next turn and persists the route", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const created = yield* session.create({})
  const first = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "model" }] })
  if (first.info.role !== "assistant") throw new Error("missing assistant message")
  expect(first.info.modelID).toBe(ModelV2.ID.make("deepseek-official/deepseek-v4-flash"))
  const second = yield* dsh.prompt({
    sessionID: created.id,
    model: {
      providerID: ProviderV2.ID.make("dsh"),
      modelID: ModelV2.ID.make("deepseek-official/deepseek-v4-pro"),
    },
    parts: [{ type: "text", text: "model" }],
  })
  if (second.info.role !== "assistant") throw new Error("missing assistant message")
  expect(second.info.modelID).toBe(ModelV2.ID.make("deepseek-official/deepseek-v4-pro"))
  expect((yield* session.get(created.id)).metadata?.dsh.model).toBe("deepseek-official/deepseek-v4-pro")
  expect(second.parts).toContainEqual(expect.objectContaining({
    type: "text",
    text: expect.stringContaining('turn 2: ["deepseek-official","deepseek-v4-pro"]'),
  }))
}), { config }, 30000)

it.instance("rejects a model that is outside the DSH catalog before starting a runtime", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const created = yield* session.create({})
  const result = yield* dsh.prompt({
    sessionID: created.id,
    model: {
      providerID: ProviderV2.ID.make("dsh"),
      modelID: ModelV2.ID.make("deepseek-official/not-configured"),
    },
    parts: [{ type: "text", text: "must not run" }],
  }).pipe(Effect.exit)
  expect(Exit.isFailure(result)).toBe(true)
  expect(yield* session.messages({ sessionID: created.id })).toEqual([])
}), { config }, 30000)

it.instance("uses the native permission request and preserves rejection", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const permission = yield* Permission.Service
  const created = yield* session.create({})
  const run = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "permission" }] }).pipe(Effect.forkChild)
  const request = yield* pollWithTimeout(permission.list().pipe(Effect.map((items) => items[0])), "DSH permission was not shown", "15 seconds")
  expect(request.sessionID).toBe(created.id)
  yield* permission.reply({ requestID: request.id, reply: "reject" })
  const result = yield* Fiber.join(run)
  expect(result.parts.find((part) => part.type === "tool")).toMatchObject({ state: { status: "error" } })
  expect(yield* permission.list()).toEqual([])
}), { config }, 30000)

it.instance("cancels active execution and clears a pending permission", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const runs = yield* SessionRunState.Service
  const permission = yield* Permission.Service
  const status = yield* SessionStatus.Service
  const created = yield* session.create({})
  const run = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "permission" }] }).pipe(Effect.forkChild)
  yield* pollWithTimeout(permission.list().pipe(Effect.map((items) => items[0])), "DSH permission was not shown", "15 seconds")
  expect((yield* status.get(created.id)).type).toBe("busy")
  yield* runs.cancel(created.id)
  yield* Fiber.join(run)
  expect(yield* permission.list()).toEqual([])
  expect((yield* status.get(created.id)).type).toBe("idle")
  const messages = yield* session.messages({ sessionID: created.id })
  expect(messages.at(-1)?.info).toMatchObject({ error: { name: "MessageAbortedError" } })
}), { config }, 30000)

it.instance("records runtime failure as an assistant error", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const created = yield* session.create({})
  const result = yield* dsh.prompt({ sessionID: created.id, parts: [{ type: "text", text: "error" }] })
  expect(result.info).toMatchObject({ error: { data: { message: expect.stringContaining("No prompt was retried") } } })
  expect(JSON.stringify(result)).not.toContain("SECRET_FROM_REMOTE")
}), { config }, 30000)

it.instance("rejects alternate agent policy and exact prompt retries before executing", () => Effect.gen(function* () {
  const session = yield* Session.Service
  const dsh = yield* DSH.Service
  const created = yield* session.create({})
  const parts = [{ type: "text" as const, text: "hello" }]
  const denied = yield* dsh.prompt({ sessionID: created.id, agent: "plan", parts }).pipe(Effect.exit)
  expect(Exit.isFailure(denied)).toBe(true)
  expect(yield* session.messages({ sessionID: created.id })).toEqual([])
  const messageID = MessageID.ascending()
  yield* dsh.prompt({ sessionID: created.id, messageID, parts })
  const duplicate = yield* dsh.prompt({ sessionID: created.id, messageID, parts }).pipe(Effect.exit)
  expect(Exit.isFailure(duplicate)).toBe(true)
  expect((yield* session.messages({ sessionID: created.id })).length).toBe(2)
  const fork = yield* session.fork({ sessionID: created.id })
  const forked = yield* dsh.prompt({ sessionID: fork.id, parts }).pipe(Effect.exit)
  expect(Exit.isFailure(forked)).toBe(true)
}), { config }, 30000)
