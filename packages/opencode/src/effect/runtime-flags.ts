import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("MOKS_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@opencode/RuntimeFlags", {
  autoShare: bool("MOKS_AUTO_SHARE"),
  pure: bool("MOKS_PURE"),
  disableDefaultPlugins: bool("MOKS_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("MOKS_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("MOKS_DISABLE_EXTERNAL_SKILLS"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("MOKS_DISABLE_CLAUDE_CODE"),
    direct: bool("MOKS_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("MOKS_DISABLE_CLAUDE_CODE"),
    direct: bool("MOKS_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("MOKS_ENABLE_EXA"),
    legacy: bool("MOKS_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("MOKS_ENABLE_PARALLEL"),
    legacy: bool("MOKS_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("MOKS_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("MOKS_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("MOKS_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("MOKS_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalOxfmt: enabledByExperimental("MOKS_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("MOKS_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("MOKS_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("MOKS_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("MOKS_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("MOKS_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("MOKS_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("MOKS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("MOKS_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("MOKS_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("MOKS_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
