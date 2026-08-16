import { afterEach, describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
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
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Budget = typeof ContextBudget.Type

// D4/C3: the baseline budget gate. The fixed per-request baseline
// (system prompt + tool roster) must stay within budget per tier so small
// windows keep real working headroom. Thresholds are deliberately above the
// currently measured values (see the assertions' messages) but low enough to
// catch regressions that reintroduce frontier-sized prompts or rosters.
const MINIMAL_BASELINE_BUDGET = 6_000
const DEFAULT_BASELINE_BUDGET = 12_000

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

const modelBase = {
  name: "Test Model",
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 56_320, output: 8_192 },
  cost: { input: 0, output: 0 },
  options: {},
}

const config = () => ({
  formatter: false,
  lsp: false,
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "tiny-model": { ...modelBase, id: "tiny-model", tier: "minimal" as const },
        "mid-model": { ...modelBase, id: "mid-model", tier: "default" as const },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
})

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

const fetchBudget = (modelID: string) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const chat = yield* Session.use.create({
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make(modelID) },
    })
    const url = new URL(pathFor(SessionPaths.contextBudget, { sessionID: chat.id }), "http://localhost")
    const response = yield* HttpClientRequest.fromWeb(
      new Request(url, { headers: { "x-opencode-directory": test.directory } }),
    ).pipe(HttpClientRequest.setUrl(url.pathname), HttpClient.execute)
    expect(response.status).toBe(200)
    return (yield* response.json) as Budget
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("baseline token budget", () => {
  it.instance(
    "minimal tier baseline stays within budget",
    () =>
      Effect.gen(function* () {
        const budget = yield* fetchBudget("tiny-model")
        expect(budget.model.tier).toBe("minimal")

        const baseline = budget.baseline.system_prompt.est_tokens + budget.baseline.tools.est_tokens
        console.log(
          `minimal baseline: ${baseline} tokens (system_prompt ${budget.baseline.system_prompt.est_tokens}, tools ${budget.baseline.tools.est_tokens} across ${budget.baseline.tools.count})`,
        )
        expect(baseline).toBeLessThanOrEqual(MINIMAL_BASELINE_BUDGET)

        // D4: per-tool detail is present and consistent with the totals.
        expect(budget.baseline.tools.tools_detail.length).toBe(budget.baseline.tools.count)
        expect(budget.baseline.tools.tools_detail.reduce((sum, item) => sum + item.est_tokens, 0)).toBe(
          budget.baseline.tools.est_tokens,
        )
        // A2: the minimal roster carries no heavyweight tools.
        const ids = budget.baseline.tools.tools_detail.map((item) => item.id)
        expect(ids).not.toContain("task")
        expect(ids).not.toContain("webfetch")
        expect(ids).not.toContain("websearch")
      }),
    { config },
  )

  it.instance(
    "default tier baseline stays within budget",
    () =>
      Effect.gen(function* () {
        const budget = yield* fetchBudget("mid-model")
        expect(budget.model.tier).toBe("default")

        const baseline = budget.baseline.system_prompt.est_tokens + budget.baseline.tools.est_tokens
        console.log(
          `default baseline: ${baseline} tokens (system_prompt ${budget.baseline.system_prompt.est_tokens}, tools ${budget.baseline.tools.est_tokens} across ${budget.baseline.tools.count})`,
        )
        expect(baseline).toBeLessThanOrEqual(DEFAULT_BASELINE_BUDGET)

        expect(budget.baseline.tools.tools_detail.length).toBe(budget.baseline.tools.count)
        expect(budget.baseline.tools.tools_detail.reduce((sum, item) => sum + item.est_tokens, 0)).toBe(
          budget.baseline.tools.est_tokens,
        )
      }),
    { config },
  )
})
