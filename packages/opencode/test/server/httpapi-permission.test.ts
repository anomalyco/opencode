import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Exit, Fiber, Layer } from "effect"
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
        expect(yield* response.json).toBe(false)
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
          config: { ...testProviderConfig(llm.url), auto_approve: { model: "test/test-model" } },
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
          expect(yield* response.json).toBe(true)
          const items = yield* permission.list()
          expect(items).toHaveLength(1)
          expect(items[0].id).toBe(requestID)

          yield* permission.reply({ requestID, reply: "reject" })
          yield* Fiber.await(fiber)
        }).pipe(provideInstanceEffect(directory))
      }),
    { timeout: 30_000 },
  )

  it.instance(
    "keeps statically denied requests out of classification",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const permission = yield* Permission.Service
        const requestID = PermissionV1.ID.ascending()
        const denied = yield* permission
          .ask({
            id: requestID,
            sessionID: SessionID.make("ses_http_permission"),
            permission: "bash",
            patterns: ["rm -rf /tmp/output"],
            metadata: { command: "rm -rf /tmp/output" },
            always: [],
            ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(denied)).toBe(true)
        expect(yield* permission.list()).toEqual([])

        const response = yield* request(`/permission/${requestID}/classify`, instance.directory)
        expect(response.status).toBe(404)
      }),
    { config: { formatter: false, lsp: false } },
  )
})
