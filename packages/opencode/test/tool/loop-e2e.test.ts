import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSummary } from "../../src/session/summary"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Agent } from "@/agent/agent"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { ToolRegistry } from "@/tool/registry"
import { LoopState } from "../../src/tool/loop-state"
import { LoopOrchestrator } from "../../src/tool/loop-orchestrator"
import { PlanCreateTool } from "../../src/tool/loop-plan-create"
import { PhaseDefineTool } from "../../src/tool/loop-phase-define"
import { VerifyQualityTool } from "../../src/tool/loop-verify-quality"
import { LoopSummaryTool } from "../../src/tool/loop-summary"
import { LoopCompleteTool } from "../../src/tool/loop-complete"
import { Tool } from "@/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { testInstanceStoreLayer, TestInstance } from "../fixture/fixture"
import { Truncate } from "@/tool/truncate"

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const ctx = {
  sessionID: SessionID.make("ses_e2e"),
  messageID: MessageID.make("msg_e2e"),
  callID: "",
  agent: "loop",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const toolLayer = Layer.mergeAll(
  Agent.defaultLayer,
  Truncate.defaultLayer,
  LoopState.defaultLayer,
  LoopOrchestrator.defaultLayer,
)

const root = LayerNode.group([ToolRegistry.node, Agent.node])
const it = testEffect(
  Layer.mergeAll(
    LayerNode.buildLayer(root, {
      replacements: [
        LayerNode.replace(MCP.node, mcp),
        LayerNode.replace(LSP.node, lsp),
        LayerNode.replace(RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })),
      ],
    }),
    toolLayer,
    testInstanceStoreLayer,
  ),
)

describe("loop agent e2e", () => {
  it.instance("full tool cycle with registry and session context", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = yield* agents.get("loop")
      const tools = yield* registry.tools({
        providerID: "" as any,
        modelID: "" as any,
        agent,
      })

      const planCreateDef = tools.find((t) => t.id === "loop_plan_create")
      expect(planCreateDef).toBeDefined()

      const planCreateInfo = yield* PlanCreateTool
      const planCreate = yield* planCreateInfo.init()
      const planResult = yield* planCreate.execute(
        {
          description: "E2E test plan",
          phases: [
            {
              id: "phase1",
              title: "Phase 1",
              scope: "First phase",
              acceptanceCriteria: ["AC1"],
            },
          ],
        },
        ctx,
      )
      expect(planResult.title).toBe("Plan created")

      const phaseDefineInfo = yield* PhaseDefineTool
      const phaseDefine = yield* phaseDefineInfo.init()
      const phaseResult = yield* phaseDefine.execute(
        { phaseId: "phase1", spec: "Updated scope" },
        ctx,
      )
      expect(phaseResult.title).toBe("Phase updated")

      const verifyInfo = yield* VerifyQualityTool
      const verify = yield* verifyInfo.init()
      const verifyResult = yield* verify.execute(
        { phaseId: "phase1", checks: ["scope", "contract"] },
        ctx,
      )
      expect(verifyResult.title).toBe("Quality passed")

      const summaryInfo = yield* LoopSummaryTool
      const summary = yield* summaryInfo.init()
      const summaryResult = yield* summary.execute({ detail: "full" }, ctx)
      expect(summaryResult.title).toBe("Loop summary generated")
      expect(summaryResult.metadata.progress).toBe(100)

      const completeInfo = yield* LoopCompleteTool
      const complete = yield* completeInfo.init()
      const completeResult = yield* complete.execute(
        { status: "success", finalSummary: "E2E test completed" },
        ctx,
      )
      expect(completeResult.title).toBe("Loop success")

      const loop = yield* LoopState.Service
      const state = yield* loop.get()
      expect(state.status).toBe("success")
      expect(state.plan).toBeNull()
    }),
  )

  it.instance("quality gate detects typecheck failure", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          path.join(test.directory, "package.json"),
          JSON.stringify({ name: "test", scripts: { typecheck: "echo 'type error' && exit 1" } }),
        ),
      )

      const planCreateInfo = yield* PlanCreateTool
      const planCreate = yield* planCreateInfo.init()
      yield* planCreate.execute(
        { description: "Quality test", phases: [{ id: "phase1", title: "Phase 1", scope: "Test scope", acceptanceCriteria: ["AC1"] }] },
        ctx,
      )

      const verifyInfo = yield* VerifyQualityTool
      const verify = yield* verifyInfo.init()
      const result = yield* verify.execute(
        { phaseId: "phase1", checks: ["typecheck"], directory: test.directory },
        ctx,
      )
      expect(result.title).toBe("Quality failed")
    }),
  )
})
