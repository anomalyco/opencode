import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Auth } from "@/auth"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { DoomLoop } from "../doom-loop"
import { usable } from "../overflow"
import { Token } from "@/util/token"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "../message-v2"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "../system"
import { SessionTier } from "../tier"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Record } from "effect"
import { jsonSchema, tool as aiTool, type ModelMessage, type Tool } from "ai"
import type { Plugin } from "@/plugin"
import { mergeDeep } from "remeda"

const USER_AGENT = `opencode/${InstallationVersion}`

type PrepareInput = {
  readonly user: SessionV1.User
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly model: Provider.Model
  readonly agent: Agent.Info
  readonly permission?: PermissionV1.Ruleset
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly small?: boolean
  readonly tools: Record<string, Tool>
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly plugin: Plugin.Interface
  readonly flags: RuntimeFlags.Info
  readonly cfg: ConfigV1.Info
  readonly isWorkflow: boolean
  readonly lastStep?: boolean
  // D2: non-primary agent names available to the task tool, computed where
  // agents are in hand (prompt loop) and carried on the telemetry headers so
  // routers can tighten task.subagent_type without probing the engine.
  readonly subagents?: readonly string[]
}

export type Prepared = {
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly params: {
    readonly temperature?: number
    readonly topP?: number
    readonly topK?: number
    readonly maxOutputTokens?: number
    readonly options: Record<string, any>
  }
  readonly messageTransformOptions: Record<string, any>
  readonly headers: Record<string, string>
  // D3: set when the C6 window-aware clamp reduced the output budget below
  // what was configured; the caller publishes session.output.clamped from it
  // (prepare itself has no bus access).
  readonly outputClamp?: { readonly requested: number; readonly granted: number }
}

const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

export const prepare = Effect.fn("LLMRequestPrep.prepare")(function* (input: PrepareInput) {
  const isOpenaiOauth = input.provider.id === "openai" && input.auth?.type === "oauth"
  const system = [
    [
      ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  ]

  const header = system[0]
  yield* input.plugin.trigger(
    "experimental.chat.system.transform",
    { sessionID: input.sessionID, model: input.model },
    { system },
  )
  if (system.length > 2 && system[0] === header) {
    const rest = system.slice(1)
    system.length = 0
    system.push(header, rest.join("\n"))
  }

  // E6: keep the leading system block byte-stable across days so the prompt
  // cache prefix survives. SystemPrompt.environment drops the volatile date
  // line on minimal/default tiers; it rides here as a trailing system message
  // instead. Vendor tiers are byte-identical to upstream, and small utility
  // calls (title, summary) don't need the date.
  const tier = SessionTier.resolve(input.model)
  if (!input.small && (tier === "minimal" || tier === "default")) {
    system.push(`Today's date: ${new Date().toDateString()}`)
  }

  const variant =
    !input.small && input.model.variants && input.user.model.variant
      ? input.model.variants[input.user.model.variant]
      : {}
  const base = input.small
    ? ProviderTransform.smallOptions(input.model)
    : ProviderTransform.options({
        model: input.model,
        sessionID: input.sessionID,
        providerOptions: input.provider.options,
      })
  const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), input.agent.options), variant)
  if (
    input.model.api.npm === "@ai-sdk/azure" &&
    (input.provider.options.useCompletionUrls || input.model.options.useCompletionUrls || options.useCompletionUrls)
  ) {
    delete options.reasoningSummary
    delete options.include
  }
  if (isOpenaiOauth) options.instructions = system.join("\n")

  const messages =
    isOpenaiOauth || input.isWorkflow
      ? input.messages
      : [
          ...system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...input.messages,
        ]

  const params = yield* input.plugin.trigger(
    "chat.params",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      temperature: input.model.capabilities.temperature
        ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
        : undefined,
      topP: input.agent.topP ?? ProviderTransform.topP(input.model),
      topK: ProviderTransform.topK(input.model),
      maxOutputTokens: ProviderTransform.maxOutputTokens(input.model, input.flags.outputTokenMax),
      options,
    },
  )

  const { headers } = yield* input.plugin.trigger(
    "chat.headers",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      headers: {},
    },
  )

  // B1: on the last permitted step the MAX_STEPS_PROMPT tells the model tools
  // are disabled — make that true on the wire instead of trusting prose. Only
  // StructuredOutput survives so a json_schema turn can still deliver its
  // result. With zero tools the AI SDK omits both tools and toolChoice.
  const resolved = resolveTools(input)
  const tools = input.lastStep ? Record.filter(resolved, (_, k) => k === "StructuredOutput") : resolved
  // Codex parity: OpenAI Responses-family providers hardcode `strict: false`
  // on every function tool so MCP-sourced and dynamic schemas that don't
  // satisfy OpenAI's structured-outputs constraints still register.
  if (
    input.model.api.npm === "@ai-sdk/openai" ||
    input.model.api.npm === "@ai-sdk/azure" ||
    input.model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
  ) {
    for (const key of Object.keys(tools)) tools[key] = { ...tools[key], strict: false }
  }
  if (
    input.model.providerID.includes("github-copilot") &&
    Object.keys(tools).length === 0 &&
    hasToolCalls(input.messages)
  ) {
    // Copilot needs a tools field when replaying prior tool calls, even if no tools are currently enabled.
    tools["_noop"] = aiTool({
      description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          reason: { type: "string", description: "Unused" },
        },
      }),
      execute: async () => ({ output: "", title: "", metadata: {} }),
    })
  }

  // Window-aware output clamp: never request more output than the usable
  // window leaves after the estimated input. This seam is where the fully
  // composed request (system + messages + resolved tools) first exists, so
  // the input estimate lives here rather than in the prompt loop. The same
  // estimates feed the D2 telemetry headers: history is the message payload,
  // baseline is everything else the request pays (system prompt + tools).
  const usableWindow = usable({
    cfg: input.cfg,
    model: input.model,
    outputTokenMax: input.flags.outputTokenMax,
    sessionID: input.sessionID,
  })
  const historyTokens = Token.estimate(JSON.stringify(input.messages))
  const toolsTokens = Token.estimate(
    JSON.stringify(Object.entries(tools).map(([name, item]) => [name, item.description, item.inputSchema])),
  )
  const baselineTokens = Token.estimate(JSON.stringify(system)) + toolsTokens
  const estimated = historyTokens + baselineTokens
  const outputClamp = (() => {
    if (usableWindow <= 0 || params.maxOutputTokens === undefined) return undefined
    const granted = Math.min(params.maxOutputTokens, Math.max(256, usableWindow - estimated))
    if (granted >= params.maxOutputTokens) return undefined
    return { requested: params.maxOutputTokens, granted }
  })()
  if (outputClamp) params.maxOutputTokens = outputClamp.granted

  const opencodeProjectID = input.model.providerID.startsWith("opencode")
    ? (yield* InstanceState.context).project.id
    : undefined

  return {
    system,
    messages,
    tools: Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b))),
    params,
    messageTransformOptions: options,
    ...(outputClamp ? { outputClamp } : {}),
    headers: {
      ...(input.model.providerID.startsWith("opencode")
        ? {
            ...(opencodeProjectID ? { "x-opencode-project": opencodeProjectID } : {}),
            "x-opencode-session": input.sessionID,
            "x-opencode-request": input.user.id,
            "x-opencode-client": input.flags.client,
            "User-Agent": USER_AGENT,
          }
        : {
            "x-session-affinity": input.sessionID,
            "X-Session-Id": input.sessionID,
            ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
            "User-Agent": USER_AGENT,
          }),
      // D2 telemetry: the engine's own context arithmetic for this request so
      // proxies/routers gate on a header comparison instead of re-tokenizing
      // the payload. est-input = history + baseline; baseline includes tools.
      // Native values come first so the chat.headers plugin hook and per-model
      // config headers may override, and can never silently lose them.
      "x-opencode-est-input-tokens": estimated.toString(),
      "x-opencode-history-tokens": historyTokens.toString(),
      "x-opencode-baseline-tokens": baselineTokens.toString(),
      "x-opencode-tools-tokens": toolsTokens.toString(),
      "x-opencode-limit-context": (input.model.limit.context ?? 0).toString(),
      "x-opencode-limit-output": ProviderTransform.maxOutputTokens(input.model, input.flags.outputTokenMax).toString(),
      "x-opencode-usable": usableWindow.toString(),
      "x-opencode-tier": tier,
      "x-opencode-session-id": input.sessionID,
      "x-opencode-agent": input.agent.name,
      ...(input.subagents?.length ? { "x-opencode-subagents": input.subagents.join(",") } : {}),
      ...input.model.headers,
      ...headers,
    },
  }
})

function resolveTools(input: Pick<PrepareInput, "tools" | "agent" | "permission" | "user" | "sessionID" | "small">) {
  // B4: tools stripped by the structural doom-loop stop stay out of the
  // roster for the session's next requests. Small-model calls (title,
  // summary) share the session ID but are not agent turns, so they must not
  // consume the strip budget.
  const stripped = input.small ? new Set<string>() : DoomLoop.consume(input.sessionID)
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k) && !stripped.has(k))
}

export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLMRequestPrep from "./request"
