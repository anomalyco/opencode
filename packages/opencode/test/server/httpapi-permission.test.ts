import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Permission } from "@/permission"
import { PermissionAutoApprove } from "@/permission/auto-approve"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Workspace } from "@/control-plane/workspace"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const root = LayerNode.group([
  InstanceStore.node,
  Project.node,
  Session.node,
  Permission.node,
  PermissionAutoApprove.node,
  Workspace.node,
  Database.node,
  Ripgrep.node,
  CrossSpawnSpawner.node,
])
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const http = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const base = AppNodeBuilder.build(root, [[InstanceStore.bootstrapNode, noopBootstrap]])
const it = testEffect(Layer.mergeAll(base, http))
const itPositive = testEffect(Layer.mergeAll(base, http, TestLLMServer.layer))

function request(path: string, directory: string) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(
    new Request(url, { method: "POST", headers: { "x-opencode-directory": directory } }),
  ).pipe(HttpClientRequest.setUrl(url.pathname), HttpClient.execute)
}

function post(path: string, directory: string, body: unknown) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(
    new Request(url, {
      method: "POST",
      headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  ).pipe(HttpClientRequest.setUrl(url.pathname), HttpClient.execute)
}

function pending(permission: Permission.Interface, id: PermissionV1.ID) {
  return permission
    .ask({
      id,
      sessionID: SessionID.make("ses_http_permission"),
      permission: "bash",
      patterns: ["git status"],
      metadata: { command: "git status" },
      always: [],
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
    })
    .pipe(Effect.forkScoped)
}

describe("permission classification HttpApi", () => {
  it.instance(
    "validates and looks up the request in the routed instance",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const requestID = PermissionV1.ID.ascending()
        const missing = yield* request(`/permission/${requestID}/classify`, instance.directory)
        expect(missing.status).toBe(404)
        expect(yield* missing.json).toEqual({
          _tag: "PermissionNotFoundError",
          requestID,
          message: `Permission request not found: ${requestID}`,
        })

        const invalid = yield* request("/permission/not-a-permission-id/classify", instance.directory)
        expect(invalid.status).toBe(400)
      }),
    { config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )

  it.instance(
    "returns a negative decision without mutating a real pending request",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const permission = yield* Permission.Service
        const requestID = PermissionV1.ID.ascending()
        const fiber = yield* pending(permission, requestID)
        yield* pollWithTimeout(
          permission
            .list()
            .pipe(Effect.map((items) => (items.some((item) => item.id === requestID) ? true : undefined))),
          "permission did not become pending",
        )

        const response = yield* request(`/permission/${requestID}/classify`, instance.directory)
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({ approved: false })
        expect((yield* permission.list()).map((item) => item.id)).toContain(requestID)

        yield* permission.reply({ requestID, reply: "reject" })
        yield* Fiber.await(fiber)
      }),
    { config: { formatter: false, lsp: false } },
  )

  itPositive.live(
    "returns a positive decision without replying to or broadening the exact request",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        const directory = yield* tmpdirScoped({
          config: {
            ...testProviderConfig(llm.url),
            experimental: { auto_approve: true },
            auto_approve: { model: "test/test-model", show_details: true },
          },
        })
        yield* llm.text("AUTO_APPROVE")
        return yield* Effect.gen(function* () {
          const permission = yield* Permission.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({})
          const userID = MessageID.ascending()
          yield* sessions.updateMessage({
            id: userID,
            sessionID: chat.id,
            role: "user",
            agent: "build",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: userID,
            sessionID: chat.id,
            type: "text",
            text: "Run git status",
          })
          const assistantID = MessageID.ascending()
          yield* sessions.updateMessage({
            id: assistantID,
            sessionID: chat.id,
            role: "assistant",
            parentID: userID,
            modelID: ModelV2.ID.make("test-model"),
            providerID: ProviderV2.ID.make("test"),
            mode: "build",
            agent: "build",
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now() },
          })
          const callID = "call_http_permission"
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistantID,
            sessionID: chat.id,
            type: "tool",
            callID,
            tool: "bash",
            state: { status: "running", input: { command: "git status" }, time: { start: Date.now() } },
          })
          const requestID = PermissionV1.ID.ascending()
          const fiber = yield* permission
            .ask({
              id: requestID,
              sessionID: chat.id,
              permission: "bash",
              patterns: ["git status"],
              metadata: { command: "git status" },
              always: [],
              tool: { messageID: assistantID, callID },
              ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
            })
            .pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            permission
              .list()
              .pipe(Effect.map((items) => (items.some((item) => item.id === requestID) ? true : undefined))),
            "permission did not become pending",
          )

          const response = yield* request(`/permission/${requestID}/classify`, directory)
          expect(response.status).toBe(200)
          expect(yield* response.json).toEqual({
            approved: true,
            details: {
              input: JSON.stringify({
                userRequest: "Run git status",
                toolCall: { name: "bash", input: { command: "git status" } },
                action: { permission: "bash", patterns: ["git status"], metadata: { command: "git status" } },
              }),
              output: "AUTO_APPROVE",
            },
          })
          const items = yield* permission.list()
          expect(items).toHaveLength(1)
          expect(items[0].id).toBe(requestID)

          yield* permission.reply({ requestID, reply: "reject" })
          yield* Fiber.await(fiber)
        }).pipe(provideInstanceEffect(directory))
      }),
    { timeout: 30_000 },
  )
})

describe("permission review overlay HttpApi", () => {
  it.instance(
    "round-trips the overlay for a session and changes what ask() does",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_http_overlay")
        const allow: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
        const bash = (id: PermissionV1.ID) =>
          permission.ask({
            id,
            sessionID,
            permission: "bash",
            patterns: ["git status"],
            metadata: { command: "git status" },
            always: [],
            ruleset: allow,
          })

        yield* bash(PermissionV1.ID.ascending())
        expect(yield* permission.overlays()).toEqual([])

        const enabled = yield* post(`/permission/session/${sessionID}/overlay`, instance.directory, { enabled: true })
        expect(enabled.status).toBe(200)
        expect(yield* enabled.json).toBe(true)
        expect(yield* permission.overlays()).toEqual([sessionID])

        const overlaidID = PermissionV1.ID.ascending()
        const fiber = yield* bash(overlaidID).pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          permission
            .list()
            .pipe(Effect.map((items) => (items.some((item) => item.id === overlaidID) ? true : undefined))),
          "overlaid permission did not become pending",
        )
        yield* permission.reply({ requestID: overlaidID, reply: "reject" })
        yield* Fiber.await(fiber)

        const disabled = yield* post(`/permission/session/${sessionID}/overlay`, instance.directory, { enabled: false })
        expect(disabled.status).toBe(200)
        expect(yield* disabled.json).toBe(false)
        expect(yield* permission.overlays()).toEqual([])
        yield* bash(PermissionV1.ID.ascending())
      }),
    { config: { formatter: false, lsp: false, experimental: { auto_approve: true } } },
    { timeout: 30_000 },
  )

  it.instance(
    "refuses to enable the overlay unless the beta flag is set",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_http_overlay_gated")

        const response = yield* post(`/permission/session/${sessionID}/overlay`, instance.directory, { enabled: true })
        expect(response.status).toBe(200)
        expect(yield* response.json).toBe(false)
        expect(yield* permission.overlays()).toEqual([])
      }),
    { config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )

  it.instance(
    "rejects a malformed payload and a malformed session id",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const permission = yield* Permission.Service
        const badPayload = yield* post("/permission/session/ses_http_overlay_bad/overlay", instance.directory, {
          enabled: "yes",
        })
        expect(badPayload.status).toBe(400)

        const badSession = yield* post("/permission/session/not-a-session-id/overlay", instance.directory, {
          enabled: true,
        })
        expect(badSession.status).toBe(400)
        expect(yield* permission.overlays()).toEqual([])
      }),
    { config: { formatter: false, lsp: false } },
    { timeout: 30_000 },
  )
})
