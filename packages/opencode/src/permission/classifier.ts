import { Effect, Layer, ServiceMap } from "effect"
import { PermissionRouter } from "./router"
import type { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { InstanceState } from "@/effect/instance-state"
import { generateText } from "ai"

export namespace PermissionClassifier {
  const log = Log.create({ service: "permission.classifier" })

  export interface Interface {
    readonly classify: (
      req: PermissionRouter.ToolCallRequest,
    ) => Effect.Effect<PermissionRouter.ClassificationResult, never>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/PermissionClassifier") {}

  type State = {
    cache: Map<string, PermissionRouter.ClassificationResult>
  }

  export function createPrompt(req: PermissionRouter.ToolCallRequest, def: PermissionRouter.ToolDefinition): string {
    const params = JSON.stringify(req.params, null, 2)
    const context = req.context

    return `You are a security classifier for AI tool calls. Analyze the following tool call and assess its risk level.

Tool ID: ${req.toolId}
Tool Description: ${def.description}
Tool Category: ${def.category}
Tool Flags:
  - Read Only: ${def.flags.isReadOnly}
  - Destructive: ${def.flags.isDestructive}
  - Network: ${def.flags.isNetwork}
  - System: ${def.flags.isSystem}
  - File System: ${def.flags.isFileSystem}

Default Risk Level: ${def.defaultRisk}

Parameters:
\`\`\`json
${params}
\`\`\`

Context:
- Working Directory: ${context.cwd}
- Previous Calls: ${context.previousCalls.join(", ") || "none"}
${context.userIntent ? `- User Intent: ${context.userIntent}` : ""}

Analyze the risk considering:
1. Does this operation modify data (destructive)?
2. Does it access sensitive system resources?
3. Does it make network requests to external services?
4. Does it read/write files outside the working directory?
5. Are the parameters suspicious or potentially harmful?
6. Is the operation reversible?

Respond with a JSON object containing:
{
  "riskLevel": "low" | "medium" | "high" | "critical",
  "confidence": number between 0 and 1,
  "reasoning": "detailed explanation of the risk assessment",
  "suggestedAction": "allow" | "ask" | "deny" | "escalate",
  "requiresHumanReview": boolean
}

Default to higher caution for destructive operations.`
  }

  export function parseResponse(text: string): PermissionRouter.ClassificationResult {
    try {
      const cleaned = text
        .replace(/```json\s*/g, "")
        .replace(/```\s*$/g, "")
        .trim()
      const json = JSON.parse(cleaned)

      return {
        riskLevel: json.riskLevel ?? "medium",
        confidence: Math.max(0, Math.min(1, json.confidence ?? 0.5)),
        reasoning: json.reasoning ?? "No reasoning provided",
        suggestedAction: json.suggestedAction ?? "ask",
        requiresHumanReview: json.requiresHumanReview ?? true,
      }
    } catch (err) {
      log.error("Failed to parse classifier response", { text, error: err })
      return {
        riskLevel: "medium",
        confidence: 0.5,
        reasoning: "Failed to parse classifier response, defaulting to medium risk",
        suggestedAction: "ask",
        requiresHumanReview: true,
      }
    }
  }

  export function determineAction(
    classification: PermissionRouter.ClassificationResult,
    def: PermissionRouter.ToolDefinition,
  ): PermissionRouter.RoutingDecision["action"] {
    const approvals = def.requiredApprovals

    if (classification.riskLevel === "critical") return "deny"
    if (classification.requiresHumanReview) return "ask"
    if (classification.confidence < 0.7) return "classify"

    if (approvals.includes("never")) return "deny"
    if (approvals.includes("auto") && classification.riskLevel === "low" && classification.confidence > 0.9) {
      return "allow"
    }
    if (approvals.includes("classifier")) {
      if (classification.suggestedAction === "allow" && classification.confidence > 0.8) return "allow"
      if (classification.suggestedAction === "deny") return "deny"
      return "ask"
    }

    return "ask"
  }

  export function getCacheKey(req: PermissionRouter.ToolCallRequest): string {
    return `${req.toolId}:${JSON.stringify(req.params)}`
  }

  export function layer(model: Provider.Model) {
    return Layer.effect(
      Service,
      Effect.gen(function* () {
        const state = yield* InstanceState.make<State>(
          Effect.fn("PermissionClassifier.state")(function* () {
            return { cache: new Map() }
          }),
        )

        const classify = Effect.fn("PermissionClassifier.classify")(function* (req: PermissionRouter.ToolCallRequest) {
          const key = getCacheKey(req)
          const s = yield* InstanceState.get(state)
          const cached = s.cache.get(key)
          if (cached) {
            log.info("Using cached classification", { toolId: req.toolId, key })
            return cached
          }

          const { getLanguage } = yield* Effect.promise(() => import("@/provider/provider").then((m) => m.Provider))
          const language = yield* Effect.promise(() => getLanguage(model))

          const def = PermissionRouter.BuiltinToolClassifications[req.toolId]
          if (!def) {
            log.warn("Unknown tool, using default classification", { toolId: req.toolId })
            const result: PermissionRouter.ClassificationResult = {
              riskLevel: "medium",
              confidence: 0.5,
              reasoning: "Unknown tool, defaulting to medium risk",
              suggestedAction: "ask",
              requiresHumanReview: true,
            }
            s.cache.set(key, result)
            return result
          }

          const prompt = createPrompt(req, def)
          log.info("Classifying tool call", { toolId: req.toolId, defaultRisk: def.defaultRisk })

          const response = yield* Effect.promise(() =>
            generateText({
              model: language,
              prompt,
              temperature: 0.1,
              maxOutputTokens: 500,
            }),
          )

          const result = parseResponse(response.text)
          s.cache.set(key, result)

          log.info("Classification complete", {
            toolId: req.toolId,
            riskLevel: result.riskLevel,
            confidence: result.confidence,
            suggestedAction: result.suggestedAction,
          })

          return result
        })

        return Service.of({ classify })
      }),
    )
  }
}
