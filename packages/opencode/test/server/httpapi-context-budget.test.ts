import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { SessionPaths, ContextBudget } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID as SessionIDType } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect } from "../lib/effect"

type Budget = typeof ContextBudget.Type

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

const config = () => ({
  ...testProviderConfig("http://localhost:1/v1"),
  model: "test/test-model",
})

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

const fetchBudget = (sessionID: SessionIDType, directory: string) =>
  Effect.gen(function* () {
    const response = yield* request(pathFor(SessionPaths.contextBudget, { sessionID }), {
      headers: { "x-opencode-directory": directory },
    })
    expect(response.status).toBe(200)
    return (yield* response.json) as Budget
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("session context budget", () => {
  it.instance(
    "returns 200 with consistent arithmetic for a fresh session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const chat = yield* Session.use.create()
        const budget = yield* fetchBudget(chat.id, test.directory)

        expect(budget.model.providerID).toBe("test")
        expect(budget.model.modelID).toBe("test-model")
        expect(budget.model.tier).toBe("default")
        expect(budget.model.limit.context).toBe(100_000)
        expect(budget.model.limit.output).toBeGreaterThan(0)
        expect(budget.usable).toBeGreaterThan(0)
        expect(budget.reserve).toBeGreaterThan(0)
        expect(budget.baseline.system_prompt.est_tokens).toBeGreaterThan(0)
        expect(budget.baseline.tools.count).toBeGreaterThan(0)
        expect(budget.baseline.tools.est_tokens).toBeGreaterThan(0)
        expect(budget.history.messages).toBe(0)
        expect(budget.history.post_compaction).toBe(false)
        expect(budget.history.last_reported).toBeUndefined()

        // Contract: components sum to next_request.est_input_tokens within 1%.
        const sum =
          budget.baseline.system_prompt.est_tokens +
          budget.baseline.tools.est_tokens +
          budget.baseline.instructions.est_tokens +
          budget.history.est_tokens
        expect(Math.abs(sum - budget.next_request.est_input_tokens)).toBeLessThanOrEqual(
          Math.max(1, budget.next_request.est_input_tokens * 0.01),
        )
        expect(budget.next_request.headroom).toBe(budget.usable - budget.next_request.est_input_tokens)
      }),
    { config },
  )

  it.instance(
    "reports history and provider-reported usage once messages exist",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Session.Service
        const chat = yield* session.create({})
        const user = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "build",
          model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: user.id,
          sessionID: chat.id,
          type: "text",
          text: "hello context budget",
        })
        const assistant: SessionV1.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: chat.id,
          parentID: user.id,
          mode: "build",
          agent: "build",
          path: { cwd: test.directory, root: test.directory },
          cost: 0,
          tokens: { input: 1200, output: 40, reasoning: 0, cache: { read: 300, write: 0 } },
          modelID: ModelV2.ID.make("test-model"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
        }
        yield* session.updateMessage(assistant)

        const budget = yield* fetchBudget(chat.id, test.directory)
        expect(budget.history.messages).toBeGreaterThan(0)
        expect(budget.history.est_tokens).toBeGreaterThan(0)
        expect(budget.history.last_reported).toEqual({ input: 1200, output: 40, cache_read: 300, total: 1540 })

        const sum =
          budget.baseline.system_prompt.est_tokens +
          budget.baseline.tools.est_tokens +
          budget.baseline.instructions.est_tokens +
          budget.history.est_tokens
        expect(Math.abs(sum - budget.next_request.est_input_tokens)).toBeLessThanOrEqual(
          Math.max(1, budget.next_request.est_input_tokens * 0.01),
        )
      }),
    { config },
  )
})
