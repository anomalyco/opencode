import { Effect, Layer, Context } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, SessionID } from "@/session/schema"
import { EngineAdapter, createEngineAdapter, type ToolAdapter, DEFAULT_TAGS } from "@/agent/engine-adapter"
import type { EngineConfig, ExecutionStrategy } from "@/agent/engine"
import type { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import { EventType, EventPriority } from "@/agent/engine/event-bus"
import { ToolRegistry } from "@/tool/registry"
import { LLMDAGGenerator, createLLMDAGGenerator } from "@/agent/engine/llm/llm-dag-generator"
import { createAutoProviderAdapter } from "@/agent/engine/llm/ai-sdk-adapter"

export interface EnginePromptConfig {
  enabled: boolean
  /** "tool" = engine executes then LLM loop responds; "full" = engine only, no loop */
  mode?: "tool" | "full"
  engineConfig?: Partial<EngineConfig>
  riskMap?: Record<string, number>
  /** Enable LLM-driven DAG planning. When false or no provider available, falls back to rule-based planner */
  enableLLMDAG?: boolean
}

const DEFAULT_RISK_MAP: Record<string, number> = {
  read: 0, glob: 0, grep: 0, webfetch: 0, websearch: 0, lsp: 0,
  question: 1, skill: 1, todowrite: 1, task: 1,
  write: 1, edit: 1, apply_patch: 1,
  bash: 2,
}

export interface EnginePromptInterface {
  readonly isEnabled: boolean
  readonly mode: "tool" | "full"
  readonly runEngineLoop: (
    sessionID: SessionID,
    goal: string,
    agentName: string,
    createUserMessage: (content: string) => Effect.Effect<SessionV1.WithParts>,
    createAssistantMessage: (content: string) => Effect.Effect<SessionV1.WithParts>,
    onProgress?: (text: string) => Effect.Effect<void>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly getAdapter: () => EngineAdapter
  readonly registerTools: (adapters: ToolAdapter[]) => void
}

export class EnginePromptService extends Context.Service<EnginePromptService, EnginePromptInterface>()(
  "@fengru/EnginePromptService",
) {}

export const layer = (config: EnginePromptConfig) =>
  Layer.effect(
    EnginePromptService,
    Effect.gen(function* () {
      const adapter = createEngineAdapter({
        maxSteps: 20,
        tokenBudget: 1_000_000,
        ...config.engineConfig,
      })

      // Wire LLM-driven DAG generation when enabled and a provider is available
      if (config.enableLLMDAG !== false) {
        try {
          const engine = adapter.getEngine()!
          const provider = createAutoProviderAdapter()
          const dagGenerator = createLLMDAGGenerator(provider)
          engine.dagGenerator = dagGenerator
        } catch {
          yield* Effect.logInfo("EnginePrompt.llmDAGFallback", { msg: "No LLM provider available, using rule-based DAG planner" })
        }
      }

      const riskMap = { ...DEFAULT_RISK_MAP, ...config.riskMap }

      // Defer tool registration — InstanceContext may not be available during layer construction
      let toolsRegistered = false as boolean
      const registerToolsFromRegistry = (): Effect.Effect<void> => {
        if (toolsRegistered) return Effect.void
        return Effect.serviceOption(ToolRegistry.Service).pipe(
          Effect.flatMap((registryOpt) => {
            if (registryOpt._tag === "None") {
              return Effect.logWarning("EnginePrompt.noRegistry", { msg: "ToolRegistry unavailable; engine has no capabilities" })
            }
            const registry = registryOpt.value
            return registry.all().pipe(
              Effect.flatMap((toolDefs) => {
                const toolAdapters: ToolAdapter[] = toolDefs.map((def) => ({
                  name: def.id,
                  description: def.description,
                  risk_level: (riskMap[def.id] ?? 0) as 0 | 1 | 2 | 3,
                  tags: DEFAULT_TAGS[def.id] ?? ["general"],
                  execute: async (inputs: Record<string, unknown>) => {
                    try {
                      const result = await Effect.runPromise(
                        def.execute(inputs as any, {
                          sessionID: "engine" as any,
                          messageID: "engine" as any,
                          agent: "primary",
                          abort: new AbortController().signal,
                          messages: [],
                          metadata: () => Effect.void,
                          ask: () => Effect.void,
                        } as any),
                      )
                      return { output: result.output, metadata: result.metadata }
                    } catch (error) {
                      return { error: String(error), tool: def.id }
                    }
                  },
                }))
                adapter.registerTools(toolAdapters)
                toolsRegistered = true
                return Effect.void
              }),
            )
          }),
        )
      }

      const svc: EnginePromptInterface = {
        isEnabled: config.enabled,
        mode: config.mode ?? "tool",

        runEngineLoop: (sessionID: SessionID, goal: string, agentName: string, createUserMessage, createAssistantMessage, onProgress) =>
          Effect.gen(function* () {
            yield* registerToolsFromRegistry()
            const workspaceHash: string = ""
            yield* Effect.logInfo("EnginePrompt.starting", { sessionID, goal })

            const engine = adapter.getEngine()!
            yield* Effect.tryPromise(() => engine.initialize(sessionID, goal, workspaceHash)).pipe(Effect.orDie)

            const caps = engine.registry.getAll()
            if (caps.length === 0) {
              return yield* createAssistantMessage("No tools registered. Engine cannot proceed.")
            }

            // Build progress log
            const log: string[] = []
            log.push(`## Engine Execution Plan`)
            log.push(`**Goal:** ${goal}`)
            log.push("")

            const { dag, strategy } = yield* Effect.tryPromise(async () => {
              return await engine.plan(goal, caps)
            }).pipe(Effect.orDie)
            log.push(`**Strategy:** ${strategy} | **Nodes:** ${dag.nodes.length}`)
            log.push("")

            const nodeList = dag.nodes.map((n) => `- \`${n.capability_id}\` (risk:${n.risk_level})`).join("\n")
            log.push(nodeList)
            log.push("")

            let completed = false
            const maxSteps = engine.maxSteps
            const startTime = Date.now()
            for (let i = 0; i < maxSteps && !completed; i++) {
              yield* Effect.tryPromise(async () => {
                await engine.createCheckpoint()
              }).pipe(Effect.orDie)
              const stepResult = yield* Effect.tryPromise(async () => {
                return await engine.executeStep()
              }).pipe(Effect.orDie)
              completed = stepResult.completed

              // Log step progress
              const dag = engine.getSnapshot().currentDAG
              if (dag) {
                const executedNodes = dag.nodes.filter((n) => n.status !== "pending")
                const lastNode = executedNodes[executedNodes.length - 1]
                if (lastNode) {
                  const icon = lastNode.status === "completed" ? "✅" : lastNode.status === "failed" ? "❌" : "⏳"
                  log.push(`Step ${i + 1}: ${icon} \`${lastNode.capability_id}\` → ${lastNode.status}`)
                }
              }
              // Stream progress to TUI
              if (onProgress) {
                yield* onProgress(log.join("\n"))
              }
            }

            const elapsed = Date.now() - startTime
            const snap = engine.getSnapshot()
            log.push("")
            log.push(`**Result:** ${completed ? "Completed" : "Incomplete"} | **State:** ${snap.state}`)
            log.push(`**Steps:** ${snap.stepCount} | **Tokens:** ${snap.tokenUsage.toLocaleString()} | **${elapsed}ms**`)

            yield* Effect.logInfo("EnginePrompt.complete", {
              sessionID,
              state: snap.state,
              steps: snap.stepCount,
              tokens: snap.tokenUsage,
            })

            return yield* createAssistantMessage(log.join("\n"))
          }),

        getAdapter: () => adapter,

        registerTools: (adapters: ToolAdapter[]) => {
          adapter.registerTools(adapters)
        },
      }

      return EnginePromptService.of(svc)
    }),
  )

export const disabledLayer = Layer.succeed(
  EnginePromptService,
  EnginePromptService.of({
    isEnabled: false,
    mode: "tool" as const,
    runEngineLoop: () => Effect.die("EnginePrompt is disabled"),
    getAdapter: () => {
      throw new Error("EnginePrompt is disabled")
    },
    registerTools: () => {},
  }),
)

export const enabledLayer = (config?: Partial<EnginePromptConfig>) =>
  layer({ enabled: true, ...config })

export * as EnginePrompt from "./prompt-engine"
