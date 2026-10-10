export * as ConfigMigrateV1 from "./migrate.js"

import { ConfigAgent } from "@opencode/schema/config/agent"
import { Schema } from "effect"
import { ConfigAgentV1 } from "./agent.js"
import { ConfigCommandV1 } from "./command.js"
import { ConfigMCPV1 } from "./mcp.js"
import { ConfigPermissionV1 } from "./permission.js"
import { ConfigProviderV1 } from "./provider.js"
import { ConfigProviderOptionsV1 } from "./provider-options.js"
import { Provider } from "../../provider.js"
import { Model } from "../../model.js"

const decodeOptions = { errors: "all", onExcessProperty: "ignore" } as const
const decodeAgent = Schema.decodeUnknownSync(Schema.fromJsonString(ConfigAgent.Info), decodeOptions)
const encodeAgent = Schema.encodeSync(ConfigAgent.Info)

function permissions(info?: ConfigPermissionV1.Info) {
  const rules = (info ?? []).flatMap(([key, rule]) => {
    const action = normalizeAction(key)
    if (typeof rule === "string") return [{ action, resource: "*", effect: rule }]
    return rule.map(([resource, effect]) => ({ action, resource, effect }))
  })
  return rules.length ? rules : undefined
}

// Map v1 permission/tool keys onto their renamed v2 tool actions so migrated rules keep matching.
export function normalizeAction(action: string) {
  if (action === "write" || action === "patch") return "edit"
  if (action === "task") return "subagent"
  if (action === "bash") return "shell"
  return action
}

export function migrateAgent(info: ConfigAgentV1.Info) {
  const body = {
    ...info.options,
    ...(info.temperature === undefined ? {} : { temperature: info.temperature }),
    ...(info.top_p === undefined ? {} : { top_p: info.top_p }),
  }
  return encodeAgent(
    decodeAgent(
      JSON.stringify({
        model: modelSelection(info.model, info.variant),
        request: Object.keys(body).length ? { body } : undefined,
        system: info.prompt,
        description: info.description,
        mode: info.mode,
        hidden: info.hidden,
        color: info.color === undefined ? undefined : info.color.startsWith("#") ? info.color : "#aaaaaa",
        steps: info.steps,
        disabled: info.disable,
        permissions: permissions(info.permission),
      }),
    ),
  )
}

export function migrateCommand(command: ConfigCommandV1.Info) {
  return {
    template: command.template,
    description: command.description,
    agent: command.agent,
    model: modelSelection(command.model, command.variant),
    subagent: command.subtask,
  }
}

export function modelSelection(input?: string, variant?: string) {
  if (input === undefined || !/^[^/#]+\/[^#]+$/.test(input)) return undefined
  const separator = input.indexOf("/")
  return {
    providerID: providerID(input.slice(0, separator)),
    model: input.slice(separator + 1),
    ...(variant === undefined || variant.length === 0 || variant.includes("#") ? {} : { variant }),
  }
}

export function migrateMcp(info: ConfigMCPV1.Info) {
  const disabled = info.enabled === undefined ? undefined : !info.enabled
  if (info.type === "local")
    return {
      type: info.type,
      command: info.command,
      cwd: info.cwd,
      environment: info.environment,
      disabled,
      timeout: info.timeout === undefined ? undefined : { catalog: info.timeout, execution: info.timeout },
    }
  return {
    type: info.type,
    url: info.url,
    headers: info.headers,
    oauth: info.oauth && {
      client_id: info.oauth.clientId,
      client_secret: info.oauth.clientSecret,
      scope: info.oauth.scope,
      callback_port: info.oauth.callbackPort,
      redirect_uri: info.oauth.redirectUri,
    },
    disabled,
    timeout: info.timeout === undefined ? undefined : { catalog: info.timeout, execution: info.timeout },
  }
}

export function migrateProvider(sourceID: string, info: ConfigProviderV1.Info) {
  if (sourceID === "azure-cognitive-services") return migrateAzureCognitiveServicesProvider(info)
  if (sourceID === "google-vertex-anthropic") return migrateGoogleVertexAnthropicProvider(info)
  return migrateStandardProvider(info)
}

function migrateStandardProvider(info: ConfigProviderV1.Info) {
  const options = ConfigProviderOptionsV1.provider(info.options ?? {})
  return {
    name: info.name,
    env: info.env,
    package: info.npm ? Provider.aisdk(info.npm) : undefined,
    compatibility: options.compatibility,
    settings: info.api ? { ...options.settings, baseURL: info.api } : info.options ? options.settings : undefined,
    headers: info.options && options.headers,
    body: info.options && options.body,
    models:
      info.models &&
      Object.fromEntries(Object.entries(info.models).map(([name, model]) => [name, migrateModel(model)])),
  }
}

function migrateAzureCognitiveServicesProvider(info: ConfigProviderV1.Info) {
  const standard = migrateStandardProvider(info)
  const migrated = {
    ...standard,
    env: standard.env?.filter((name) => name !== "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME"),
  }
  if (info.npm !== "@ai-sdk/openai-compatible" || info.api) return migrated
  return {
    ...migrated,
    settings: {
      ...migrated.settings,
      baseURL: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai",
    },
  }
}

function migrateGoogleVertexAnthropicProvider(info: ConfigProviderV1.Info) {
  const migrated = migrateStandardProvider(info)
  const packageName = migrated.package ?? Provider.aisdk("@ai-sdk/google-vertex/anthropic")
  return {
    ...migrated,
    // The current Google Vertex provider includes Gemini and Claude. Keep the Anthropic SDK on Claude models
    // instead of changing the package inherited by every model on the provider.
    package: undefined,
    models:
      migrated.models &&
      Object.fromEntries(
        Object.entries(migrated.models).map(([name, model]) => [
          name,
          model.package ? model : { ...model, package: packageName },
        ]),
      ),
  }
}

// Renames retired provider IDs in V1 fields and the shared top-level model.
export function providerID(input: string) {
  if (input === "azure-cognitive-services") return "azure"
  if (input === "google-vertex-anthropic") return "google-vertex"
  return input
}

function migrateModel(info: typeof ConfigProviderV1.Model.Type) {
  const disableThinkingBlockBinding =
    info.options?.thinking?.blockBinding === false || info.options?.reasoningConfig?.blockBinding === false
  const options = info.options && { ...info.options }

  // Move the legacy opt-out to compatibility without mutating the input.
  if (options && disableThinkingBlockBinding) {
    for (const key of ["thinking", "reasoningConfig"]) {
      if (options[key]?.blockBinding !== false) continue

      const { blockBinding, ...rest } = options[key]
      if (Object.keys(rest).length) {
        options[key] = rest
        continue
      }
      delete options[key]
    }
  }

  const settings = options && ConfigProviderOptionsV1.model(options)
  const compatibility = Model.compatibility(info.interleaved)
  const costs = info.cost && [
    {
      input: info.cost.input,
      output: info.cost.output,
      cache: { read: info.cost.cache_read, write: info.cost.cache_write },
    },
    ...(info.cost.context_over_200k
      ? [
          {
            tier: { type: "context" as const, size: 200_000 },
            input: info.cost.context_over_200k.input,
            output: info.cost.context_over_200k.output,
            cache: { read: info.cost.context_over_200k.cache_read, write: info.cost.context_over_200k.cache_write },
          },
        ]
      : []),
  ]
  const defaults = Model.Capabilities.default()
  const capabilities =
    info.tool_call !== undefined || info.modalities?.input !== undefined || info.modalities?.output !== undefined
      ? {
          tools: info.tool_call ?? defaults.tools,
          input: info.modalities?.input ?? defaults.input,
          output: info.modalities?.output ?? defaults.output,
        }
      : undefined
  return {
    modelID: info.id,
    family: info.family,
    name: info.name,
    compatibility: disableThinkingBlockBinding
      ? { ...compatibility, supportsThinkingBlockBinding: false }
      : compatibility,
    package: info.provider?.npm ? Provider.aisdk(info.provider.npm) : undefined,
    settings: info.provider?.api ? { ...settings, baseURL: info.provider.api } : settings,
    capabilities,
    headers: info.headers,
    variants:
      info.variants &&
      Object.entries(info.variants).map(([id, options]) => ({
        id,
        settings: ConfigProviderOptionsV1.model(options),
      })),
    cost: costs,
    disabled: info.status === "deprecated" ? true : undefined,
    limit: info.limit && {
      context: int(info.limit.context),
      input: info.limit.input === undefined ? undefined : int(info.limit.input),
      output: int(info.limit.output),
    },
  }
}

function int(value: number) {
  return Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)))
}
