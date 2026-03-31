import { Effect, Layer } from "effect"
import { PermissionRouter } from "./router"
import { PermissionClassifier } from "./classifier"
import { Log } from "@/util/log"
import { InstanceState } from "@/effect/instance-state"
import type { Provider } from "@/provider/provider"

export namespace PermissionRouterService {
  const log = Log.create({ service: "permission.router.service" })

  type State = {
    tools: Map<string, PermissionRouter.ToolDefinition>
  }

  function validateParams(def: PermissionRouter.ToolDefinition, params: Record<string, unknown>): boolean {
    try {
      def.parameters.parse(params)
      return true
    } catch {
      return false
    }
  }

  export const layer = (model: Provider.Model) =>
    Layer.effect(
      PermissionRouter.Service,
      Effect.gen(function* () {
        const state = yield* InstanceState.make<State>(
          Effect.fn("PermissionRouterService.state")(function* () {
            const tools = new Map<string, PermissionRouter.ToolDefinition>()
            
            for (const [id, def] of Object.entries(PermissionRouter.BuiltinToolClassifications)) {
              tools.set(id, def)
            }
            
            return { tools }
          }),
        )

        const s = yield* InstanceState.get(state)

        return PermissionRouter.Service.of({
          register: (def) => Effect.sync(() => {
            s.tools.set(def.id, def)
            log.info("Registered tool", { toolId: def.id })
          }),
          
          route: (req) => Effect.sync(() => {
            log.info("Routing", { toolId: req.toolId })
            const def = s.tools.get(req.toolId)
            const risk = def?.defaultRisk ?? "medium"
            return {
              toolId: req.toolId,
              action: (risk === "low" ? "allow" : "ask") as "allow" | "deny" | "ask" | "classify",
              riskLevel: risk,
              reasoning: "Routed based on tool classification",
            }
          }),
          
          validate: (req) => Effect.sync(() => {
            const def = s.tools.get(req.toolId)
            if (!def) throw new Error("Tool not found")
            if (!validateParams(def, req.params)) throw new Error("Invalid params")
          }),
          
          classify: (req) => Effect.sync(() => {
            const def = s.tools.get(req.toolId)
            return {
              riskLevel: def?.defaultRisk ?? "medium",
              confidence: 0.8,
              reasoning: "Based on tool definition",
              suggestedAction: (def?.defaultRisk === "low" ? "allow" : "ask") as "allow" | "ask" | "deny" | "escalate",
              requiresHumanReview: def?.defaultRisk !== "low",
            }
          }),
          
          getToolDef: (toolId) => Effect.sync(() => s.tools.get(toolId)),
          
          listTools: () => Effect.sync(() => Array.from(s.tools.values())),
        })
      }),
    )
}
