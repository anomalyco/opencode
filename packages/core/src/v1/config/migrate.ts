export * as ConfigMigrateV1 from "./migrate.js"

import { Info } from "@opencode-ai/schema/config"
import { ConfigAgent } from "@opencode-ai/schema/config/agent"
import { Schema } from "effect"
import { ConfigV1 } from "./config.js"
import { ConfigAgentV1 } from "./agent.js"
import { ConfigCommandV1 } from "./command.js"
import { ConfigMCPV1 } from "./mcp.js"
import { ConfigPermissionV1 } from "./permission.js"
import { ConfigProviderV1 } from "./provider.js"
import { ConfigProviderOptionsV1 } from "./provider-options.js"
import { Provider } from "../../provider.js"
import { Model } from "../../model.js"

const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
const decodeInfo = Schema.decodeUnknownSync(Schema.fromJsonString(Info), decodeOptions)
const encodeInfo = Schema.encodeSync(Info)
const decodeAgent = Schema.decodeUnknownSync(Schema.fromJsonString(ConfigAgent.Info), decodeOptions)
const encodeAgent = Schema.encodeSync(ConfigAgent.Info)
export function migrate(info: typeof ConfigV1.Info.Type) {
  return encodeInfo(
    decodeInfo(
      JSON.stringify({
        $schema: info.$schema,
        shell: info.shell,
        model: modelSelection(info.model),
        default_agent: info.default_agent,
        autoupdate: info.autoupdate,
        share: info.share ?? (info.autoshare ? "auto" : undefined),
        enterprise: info.enterprise,
        username: info.username,
        permissions: permissions(info.permission, info.tools),
        agents: agents(info),
        snapshots: info.snapshot,
        watcher: info.watcher,
        formatter: info.formatter,
        lsp: info.lsp,
        media: info.attachment,
        tool_output: info.tool_output,
        mcp: mcp(info),
        compaction: info.compaction && {
          auto: info.compaction.auto,
          prune: info.compaction.prune,
          keep: {
            tokens: info.compaction.preserve_recent_tokens,
          },
          buffer: info.compaction.reserved,
        },
        skills: info.skills && [...(info.skills.paths ?? []), ...(info.skills.urls ?? [])],
        commands: commands(info.command),
        instructions: info.instructions,
        references: info.references ?? info.reference,
        experimental: experimental(info),
        plugins: info.plugin?.map((plugin) =>
          typeof plugin === "string" ? plugin : { package: plugin[0], options: plugin[1] },
        ),
        providers: providers(info.provider),
      }),
    ),
  )
}

function experimental(info: typeof ConfigV1.Info.Type) {
  const policies = [
    ...(info.enabled_providers === undefined
      ? []
      : [
          { action: "provider.use" as const, resource: "*", effect: "deny" as const },
          ...info.enabled_providers.map((resource) => ({
            action: "provider.use" as const,
            resource: providerID(resource),
            effect: "allow" as const,
          })),
        ]),
    ...(info.disabled_providers ?? []).map((resource) => ({
      action: "provider.use" as const,
      resource: providerID(resource),
      effect: "deny" as const,
    })),
  ]
  if (info.experimental?.subagent_depth === undefined && !policies.length) return
  return {
    subagent_depth: info.experimental?.subagent_depth,
    policies: policies.length ? policies : undefined,
  }
}

function permissions(info?: ConfigPermissionV1.Info, tools?: Readonly<Record<string, boolean>>) {
  const rules: Array<{ action: string; resource: string; effect: ConfigPermissionV1.Action }> = Object.entries(
    tools ?? {},
  ).map(([action, enabled]) => ({
    action: normalizeAction(action),
    resource: "*",
    effect: enabled ? ("allow" as const) : ("deny" as const),
  }))
  for (const [key, rule] of Object.entries(info ?? {})) {
    if (!rule) continue
    const action = normalizeAction(key)
    if (typeof rule === "string") {
      rules.push({ action, resource: "*", effect: rule })
      continue
    }
    rules.push(...Object.entries(rule).map(([resource, effect]) => ({ action, resource, effect })))
  }
  return rules.length ? rules : undefined
}

// Map v1 permission/tool keys onto their renamed v2 tool actions so migrated rules keep matching.
export function normalizeAction(action: string) {
  if (action === "write" || action === "patch") return "edit"
  if (action === "task") return "subagent"
  if (action === "bash") return "shell"
  return action
}

function agents(info: typeof ConfigV1.Info.Type) {
  const entries = [
    ...Object.entries(info.agent ?? {}),
    ...Object.entries(info.mode ?? {}).map(([name, agent]) => [name, { ...agent, mode: "primary" as const }] as const),
  ]
  const result = Object.fromEntries(entries.flatMap(([name, agent]) => (agent ? [[name, migrateAgent(agent)]] : [])))
  const small = modelSelection(info.small_model)
  if (!small) return entries.length ? result : undefined
  return {
    ...result,
    title: {
      model: small,
      ...result.title,
    },
  }
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

export function commands(info?: Readonly<Record<string, ConfigCommandV1.Info>>) {
  if (!info) return undefined
  return Object.fromEntries(
    Object.entries(info).map(([id, command]) => [
      id,
      {
        template: command.template,
        description: command.description,
        agent: command.agent,
        model: modelSelection(command.model, command.variant),
        subtask: command.subtask,
      },
    ]),
  )
}

function modelSelection(input?: string, variant?: string) {
  if (input === undefined || !/^[^/#]+\/[^#]+$/.test(input)) return undefined
  const separator = input.indexOf("/")
  return {
    providerID: providerID(input.slice(0, separator)),
    model: input.slice(separator + 1),
    ...(variant === undefined || variant.length === 0 || variant.includes("#") ? {} : { variant }),
  }
}

function mcp(info: typeof ConfigV1.Info.Type) {
  const servers = Object.fromEntries(
    Object.entries(info.mcp ?? {}).flatMap(([name, server]) =>
      "type" in server ? [[name, migrateMcp(server)] as const] : [],
    ),
  )
  const timeout = info.experimental?.mcp_timeout
  if (!timeout && !Object.keys(servers).length) return undefined
  return { timeout: timeout === undefined ? undefined : { catalog: timeout, execution: timeout }, servers }
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

function providers(info?: Readonly<Record<string, ConfigProviderV1.Info>>) {
  if (!info) return undefined
  return Object.fromEntries(
    Object.entries(info).flatMap(([name, provider]) => {
      const id = providerID(name)
      // If both names are present, keep the settings under the current name and ignore the old one.
      if (id !== name && info[id]) return []
      return [[id, migrateProvider(name, provider)]]
    }),
  )
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

// Rename these only while migrating unambiguous V1 fields.
export function providerID(input: string) {
  if (input === "azure-cognitive-services") return "azure"
  if (input === "google-vertex-anthropic") return "google-vertex"
  return input
}

function migrateModel(info: typeof ConfigProviderV1.Model.Type) {
  const settings = info.options && ConfigProviderOptionsV1.model(info.options)
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
  const capabilities =
    info.tool_call !== undefined || info.modalities?.input !== undefined || info.modalities?.output !== undefined
      ? { tools: info.tool_call ?? false, input: info.modalities?.input ?? [], output: info.modalities?.output ?? [] }
      : undefined
  return {
    modelID: info.id,
    family: info.family,
    name: info.name,
    compatibility: Model.compatibility(info.interleaved),
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
