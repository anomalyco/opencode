import { LayerNode } from "../effect/layer-node"
import { Effect, Context, Layer, Ref } from "effect"
import { LLM, Message } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import { llmClient } from "../effect/app-node-platform"

const SAFE_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "websearch",
  "webfetch",
  "todowrite",
  "skill",
  "question",
])

const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20
const CLASSIFIER_TIMEOUT_MS = 10_000

export type ClassifyResult = "allow" | "deny" | "ask"

interface DenialState {
  consecutive: number
  total: number
}

export interface PermissionRequest {
  readonly id: string
  readonly sessionID: string
  readonly action: string
  readonly resources: readonly string[]
  readonly metadata?: Record<string, unknown>
  readonly save?: readonly string[]
  readonly source?: { type: string; messageID: string; callID: string }
}

export interface Interface {
  readonly isSafeTool: (action: string) => boolean
  readonly classify: (
    request: PermissionRequest,
    sessionID: string,
  ) => Effect.Effect<ClassifyResult, any, any>
  readonly recordDenial: (sessionID: string) => Effect.Effect<void, never>
  readonly resetDenials: (sessionID: string) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionClassifier") {}

const CLASSIFIER_SYSTEM_PROMPT = `You are a permission classifier for an AI coding agent. Your job is to decide if a tool permission request is safe to auto-approve.

RULES:
1. ALLOW if the request is routine, non-destructive, and clearly aligned with the user's stated intent
2. DENY if the request could cause data loss, security issues, credential exposure, or is clearly harmful
3. ASK if you are uncertain, or if the request seems outside the scope of what the user asked for

COMMON SAFE PATTERNS (usually ALLOW):
- Reading files in the project directory
- Running git commands (status, log, diff, add, commit, push, pull, branch)
- Running package manager commands (npm test, npm install, pip install, cargo build)
- Creating or editing source code files
- Running linters and formatters
- Listing directory contents

DANGEROUS PATTERNS (usually DENY):
- Deleting files or directories (rm -rf, rm -r)
- Modifying system files or configurations
- Exposing secrets, keys, or credentials
- Network requests to unknown endpoints
- Installing unknown packages from untrusted sources
- Modifying .git directory or git config
- Running sudo or elevated commands
- Chmod or permission changes on system files

Respond with ONLY a JSON object: { "decision": "allow" | "deny" | "ask", "reason": "brief explanation" }`

function buildClassifierPrompt(request: PermissionRequest): string {
  const resources = request.resources.join(", ")
  const metadataStr = request.metadata ? JSON.stringify(request.metadata, null, 2) : "{}"

  return `TOOL PERMISSION REQUEST:
- Tool/Action: ${request.action}
- Resources: ${resources}
- Metadata: ${metadataStr}

Is this request safe to auto-approve? Respond with JSON only.`
}

export type ModelResolver = (providerID: string) => Effect.Effect<{ id: string; providerID: string } | undefined, any, any>

export const make = (modelResolver: ModelResolver) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const denials = yield* Ref.make(new Map<string, DenialState>())

      const isSafeTool = (action: string): boolean => SAFE_TOOLS.has(action)

      const getDenialState = (sessionID: string): Effect.Effect<DenialState, never> =>
        Effect.map(Ref.get(denials), (map) => map.get(sessionID) ?? { consecutive: 0, total: 0 })

      const recordDenial = (sessionID: string) =>
        Ref.update(denials, (map) => {
          const existing = map.get(sessionID) ?? { consecutive: 0, total: 0 }
          const updated = new Map(map)
          updated.set(sessionID, {
            consecutive: existing.consecutive + 1,
            total: existing.total + 1,
          })
          return updated
        })

      const resetDenials = (sessionID: string) =>
        Ref.update(denials, (map) => {
          const updated = new Map(map)
          updated.set(sessionID, { consecutive: 0, total: 0 })
          return updated
        })

      const classify = Effect.fn("PermissionClassifier.classify")(function* (
        request: PermissionRequest,
        sessionID: string,
      ) {
        const denialState = yield* getDenialState(sessionID)
        if (denialState.consecutive >= MAX_CONSECUTIVE_DENIALS) {
          yield* Effect.logWarning("Permission classifier: consecutive denial limit reached, escalating to manual", {
            sessionID,
            consecutive: denialState.consecutive,
          })
          return "ask" as const
        }
        if (denialState.total >= MAX_TOTAL_DENIALS) {
          yield* Effect.logWarning("Permission classifier: total denial limit reached, escalating to manual", {
            sessionID,
            total: denialState.total,
          })
          return "ask" as const
        }

        const model = yield* modelResolver("default")
        if (!model) {
          yield* Effect.logWarning("Permission classifier: no model available, falling back to manual")
          return "ask" as const
        }

        const llm = yield* LLMClient.Service
        const prompt = buildClassifierPrompt(request)

        const llmRequest = LLM.request({
          model: model as any,
          system: CLASSIFIER_SYSTEM_PROMPT,
          messages: [Message.user(prompt)],
          generation: {
            maxTokens: 150,
            temperature: 0,
          },
        })

        const response = yield* llm.generate(llmRequest).pipe(
          Effect.timeoutOrElse({
            duration: CLASSIFIER_TIMEOUT_MS,
            orElse: () => Effect.succeed(undefined),
          }),
          Effect.catchTag("LLM.Error", () => Effect.succeed(undefined)),
        )

        if (!response) {
          return "ask" as const
        }

        const text = response.text.trim()
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (!jsonMatch) {
            yield* Effect.logWarning("Permission classifier: no JSON in response", { text })
            return "ask" as const
          }

          const result = JSON.parse(jsonMatch[0])
          if (result.decision !== "allow" && result.decision !== "deny" && result.decision !== "ask") {
            yield* Effect.logWarning("Permission classifier: invalid decision", { decision: result.decision })
            return "ask" as const
          }

          yield* Effect.logInfo("Permission classifier: decision", {
            action: request.action,
            decision: result.decision,
            reason: result.reason,
          })

          return result.decision
        } catch (error) {
          yield* Effect.logWarning("Permission classifier: failed to parse response", {
            text,
            error: String(error),
          })
          return "ask" as const
        }
      })

      return Service.of({
        isSafeTool,
        classify,
        recordDenial,
        resetDenials,
      })
    }),
  )

const defaultModelResolver: ModelResolver = () => Effect.succeed(undefined)

export const node = LayerNode.make({
  service: Service,
  layer: make(defaultModelResolver),
  deps: [llmClient],
})

export const PermissionClassifier = { Service, make, node }
