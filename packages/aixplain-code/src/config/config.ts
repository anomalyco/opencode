import * as Log from "@aixplain/core/util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { mergeDeep } from "remeda"
import { Global } from "@aixplain/core/global"
import fsNode from "fs/promises"
import { NamedError } from "@aixplain/core/util/error"
import { Flag } from "@aixplain/core/flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { InstallationLocal, InstallationVersion } from "@aixplain/core/installation/version"
import { existsSync } from "fs"
import { Account } from "@/account/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@aixplain/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { EffectFlock } from "@aixplain/core/util/effect-flock"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { NonNegativeInt, PositiveInt, type DeepMutable } from "@aixplain/core/schema"
import { ConfigAgent } from "./agent"
import { ConfigAttachment } from "./attachment"
import { ConfigCommand } from "./command"
import { ConfigError } from "./error"
import { ConfigFormatter } from "./formatter"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigManaged } from "./managed"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"
import { ConfigReference } from "./reference"
import { ConfigServer } from "./server"
import { ConfigSkills } from "./skills"
import { ConfigTrust } from "./trust"
import { ConfigVariable } from "./variable"
import { Npm } from "@aixplain/core/npm"

const log = Log.create({ service: "config" })

// Custom merge function that concatenates array fields instead of replacing them
// Keep remeda's deep conditional merge type out of hot config-loading paths; TS profiling showed it dominates here.
function mergeConfig(target: Info, source: Info): Info {
  return mergeDeep(target, source) as Info
}

function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

/**
 * Decode raw config data, rejecting `mcp` entries the schema would otherwise
 * accept by discarding most of them.
 *
 * `ConfigParse.schema` only reports *top-level* unknown keys — it bails on any
 * schema carrying index signatures, and `mcp` is a `Schema.Record`. Combined
 * with the permissive `{ enabled }` union arm, that let a misspelled or
 * half-written server entry decode cleanly and then disappear from every
 * surface (#198). Checking the raw data here is what makes it loud.
 *
 * Skipped for untrusted fragments. `mcp` is stripped from an untrusted repo by
 * the #121 gate anyway, so there is nothing to warn a legitimate user about —
 * and throwing here would run *before* that stripping, letting a repo you only
 * opened brick config loading in its directory. For those fragments we also
 * blank `mcp` to `{}` before `ConfigParse.schema` — skipping only the pre-decode
 * check is not enough, because entries that omit both `type` and `enabled`
 * match no union arm and still throw. #147 made the same call for
 * auto-discovered commands/agents ("tolerate a malformed untrusted repo so it
 * cannot turn the skip path into a startup crash"); this keeps that guarantee.
 * #199's trust notice is what tells the user their `mcp` was ignored.
 */
function parseConfig(data: unknown, source: string, trust: "trusted" | "untrusted" = "trusted") {
  // Untrusted local fragments discard `mcp` moments later via neutralizeLocalFragment.
  // Skip the loud pre-decode check *and* blank the key before schema decode so no
  // entry shape can reach the union (ConfigParse.schema would still throw for
  // entries that omit both `type` and `enabled`). Keep `mcp: {}` present so
  // mergeLocal still reports the strip in trust.stripped (#147 / #201 review / #212).
  if (trust === "untrusted") {
    const forDecode = isRecord(data) && data.mcp !== undefined ? { ...data, mcp: {} } : data
    return ConfigParse.schema(Info, forDecode, source)
  }
  const mcp = !isRecord(data) ? [] : ConfigMCP.issues(data["mcp"])
  if (mcp.length) {
    throw new ConfigError.InvalidError({
      path: source,
      // No `mcp.<key>` prefix on the message: every renderer of these issues
      // appends `path`, so the server name is already shown.
      issues: mcp.map(({ key, message }) => ({ message, path: ["mcp", key] })),
    })
  }
  return ConfigParse.schema(Info, data, source)
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in aiXplain config are deprecated; move them to tui.json", { path: source })
  return copy
}

// #198: Effect Schema drops excess object keys, so a misspelled key inside an mcp entry
// (e.g. "env" instead of "environment") can be discarded without a word. Check the raw
// parsed config before decode and fail loudly. Kept exported for existing callers/tests;
// the diagnostics live in ConfigMCP.issues so every surface reports the same thing.
export function requireValidMcpEntries(parsed: unknown, source: string) {
  if (!isRecord(parsed) || !isRecord(parsed["mcp"])) return
  const issues = Object.entries(parsed["mcp"]).flatMap(([key, entry]) =>
    // Non-object entries are reported by the schema; keep this pre-decode check
    // focused on the object shapes it would otherwise silently mangle.
    !isRecord(entry) ? [] : ConfigMCP.entryIssues(entry).map((message) => ({ key, message })),
  )
  if (!issues.length) return
  throw new Error(
    `Invalid config in ${source}: ${issues.map((issue) => `mcp entry "${issue.key}" ${issue.message}`).join("; ")}`,
  )
}

async function substituteWellKnownRemoteConfig(input: { value: unknown; dir: string; source: string }) {
  if (!isRecord(input.value) || typeof input.value.url !== "string") return

  const url = await ConfigVariable.substitute({
    text: input.value.url,
    type: "virtual",
    dir: input.dir,
    source: input.source,
  })
  const headers = isRecord(input.value.headers)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(async ([key, value]) => [
              key,
              await ConfigVariable.substitute({
                text: value,
                type: "virtual",
                dir: input.dir,
                source: input.source,
              }),
            ]),
        ),
      )
    : undefined

  return { url, headers }
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export type Layout = ConfigLayout.Layout

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({
    description: "Default shell to use for terminal and bash tool",
  }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServer.Server).annotate({
    description: "Server configuration for aiXplain serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommand.Info)).annotate({
    description: "Command configuration, see https://aiXplain.com/docs/commands",
  }),
  skills: Schema.optional(ConfigSkills.Info).annotate({ description: "Additional skill folder paths" }),
  reference: Schema.optional(ConfigReference.Info).annotate({
    description: "Named git or local directory references that can be mentioned as @alias or @alias/path",
  }),
  watcher: Schema.optional(
    Schema.Struct({
      ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  trustedDirectories: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Absolute directory paths that are trusted to run project-local config (MCP/LSP/formatter commands, plugins, provider overrides, permission changes including per-agent, auto-discovered agents/commands, {file:}/{env:} expansion). Set this only in your GLOBAL config; it is ignored from project-local config. See workspace trust (#121).",
  }),
  // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPlugin.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(ConfigAgent.Info),
        plan: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(ConfigAgent.Info),
        build: Schema.optional(ConfigAgent.Info),
        // subagent
        general: Schema.optional(ConfigAgent.Info),
        explore: Schema.optional(ConfigAgent.Info),
        scout: Schema.optional(ConfigAgent.Info),
        // specialized
        title: Schema.optional(ConfigAgent.Info),
        summary: Schema.optional(ConfigAgent.Info),
        compaction: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://aiXplain.com/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  // `ConfigMCP.Entry` includes the legacy `{ enabled: false }` arm. That arm keeps
  // extra keys only long enough to reject them, and `parseConfig` reports the
  // malformed entries with actionable messages before decoding (#198).
  mcp: Schema.optional(Schema.Record(Schema.String, ConfigMCP.Entry)).annotate({
    description: "MCP (Model Context Protocol) server configurations",
  }),
  formatter: Schema.optional(ConfigFormatter.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: Schema.optional(ConfigLSP.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayout.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermission.Info),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: Schema.optional(ConfigAttachment.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }),
    }),
  ),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
    }),
  ),
  review: Schema.optional(
    Schema.Struct({
      effort: Schema.optional(Schema.Literals(["fast", "balanced", "thorough"])).annotate({
        description:
          "Default review depth. fast = single-pass reviewer; balanced = relevant specialists + verification of high-severity findings; thorough = all specialists + verification of every finding.",
      }),
      models: Schema.optional(
        Schema.Struct({
          heavy: Schema.optional(ConfigModelID).annotate({
            description:
              "Soft model pin (provider/model) for reasoning-heavy review agents (code review, verification). Falls back to the session model if not present in the catalog.",
          }),
          light: Schema.optional(ConfigModelID).annotate({
            description:
              "Soft model pin (provider/model) for lighter review agents (comments, types). Falls back to the session model if not present in the catalog.",
          }),
        }),
      ).annotate({ description: "Optional per-tier model pins for review specialists." }),
      comment: Schema.optional(Schema.Boolean).annotate({
        description: "When reviewing a GitHub PR, post findings as inline review comments via `gh` (default: false).",
      }),
      verify_threshold: Schema.optional(Schema.Literals(["critical", "important", "suggestion"])).annotate({
        description:
          "Minimum severity that triggers an adversarial verification pass at effort=balanced (default: important).",
      }),
    }),
  ).annotate({ description: "Multi-specialist PR review configuration." }),
}).annotate({ identifier: "Config" })

// Uses the shared `DeepMutable` from `@aixplain/core/schema`. See the definition
// there for why the local variant is needed over `Types.DeepMutable` from
// effect-smol (the upstream version collapses `unknown` to `{}`).
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

/**
 * Workspace-trust outcome for the opened directory (#121). A Schema rather than a
 * plain type because it crosses the HTTP boundary: the TUI/desktop need it to tell
 * the user *why* their project-local `mcp`/`lsp`/`provider` config had no effect,
 * which is otherwise indistinguishable from having no config at all (#151).
 */
export const TrustState = Schema.Struct({
  trusted: Schema.Boolean.annotate({ description: "Whether project-local config is honored for this directory" }),
  directory: Schema.String.annotate({ description: "The directory the decision applies to" }),
  stripped: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Dangerous local-config keys ignored because the workspace is untrusted",
  }),
}).annotate({ identifier: "ConfigTrustState" })
export type TrustState = Schema.Schema.Type<typeof TrustState>

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
  trust: TrustState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly getTrust: () => Effect.Effect<TrustState>
  readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly invalidate: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aixplain/Config") {}

function globalConfigFile() {
  const candidates = ["aixplainCode.jsonc", "aixplainCode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

export const ConfigDirectoryTypoError = NamedError.create("ConfigDirectoryTypoError", {
  path: Schema.String,
  dir: Schema.String,
  suggestion: Schema.String,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
      // Untrusted project-local fragments (#121): suppress {env:}/{file:}
      // expansion so a malicious repo config cannot exfiltrate env/files at
      // load time. Defaults to trusted (normal expansion) for all other sources.
      trust: "trusted" | "untrusted" = "trusted",
    ) {
      const source = "path" in options ? options.path : options.source
      const missing = trust === "untrusted" ? ("skip" as const) : undefined
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options
            ? { text, type: "path", path: options.path, missing }
            : { text, type: "virtual", ...options, missing },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = parseConfig(normalizeLoadedConfig(parsed, source), source, trust)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://aiXplain.com/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://aiXplain.com/config.json",')
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string, trust: "trusted" | "untrusted" = "trusted") {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath }, trust)
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = {}
      // Seed the default global config with the schema for editor completion, but avoid writing when the user
      // explicitly routes config through env-provided paths or content.
      if (!Flag.AIXPLAIN_CODE_CONFIG && !Flag.AIXPLAIN_CODE_CONFIG_DIR && !Flag.AIXPLAIN_CODE_CONFIG_CONTENT) {
        const file = globalConfigFile()
        if (!existsSync(file)) {
          yield* fs
            .writeWithDirs(file, JSON.stringify({ $schema: "https://aiXplain.com/config.json" }, null, 2))
            .pipe(Effect.catch(() => Effect.void))
        }
      }
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "config.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "aixplainCode.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "aixplainCode.jsonc")))

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://aiXplain.com/config.json"
              result = mergeConfig(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "AIXPLAIN_CODE_CONFIG_CONTENT") return "local"
          if (containsPath(source, ctx)) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPlugin.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          return mergePluginOrigins(source, next.plugin, kind)
        }

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            process.env[value.key] = value.token
            log.debug("fetching remote config", { url: `${url}/.well-known/aixplain-code` })
            const response = yield* Effect.promise(() => fetch(`${url}/.well-known/aixplain-code`))
            if (!response.ok) {
              throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
            }
            const wellknown = (yield* Effect.promise(() => response.json())) as {
              config?: Record<string, unknown>
              remote_config?: unknown
            }
            const remote = yield* Effect.promise(() =>
              substituteWellKnownRemoteConfig({
                value: wellknown.remote_config,
                dir: url,
                source: `${url}/.well-known/aixplain-code`,
              }),
            )
            const fetchedConfig = remote
              ? ((yield* Effect.promise(async () => {
                  log.debug("fetching remote config", { url: remote.url })
                  const response = await fetch(remote.url, { headers: remote.headers })
                  if (!response.ok)
                    throw new Error(`failed to fetch remote config from ${remote.url}: ${response.status}`)
                  const data = await response.json()
                  return isRecord(data) && isRecord(data.config) ? data.config : data
                })) as Record<string, unknown>)
              : {}
            const remoteConfig = mergeConfig(wellknown.config ?? {}, fetchedConfig as Info)
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://aiXplain.com/config.json"
            const source = `${url}/.well-known/aixplain-code`
            const next = yield* loadConfig(JSON.stringify(remoteConfig), {
              dir: path.dirname(source),
              source,
            })
            yield* merge(source, next, "global")
            log.debug("loaded remote config from well-known", { url })
          }
        }

        const global = yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        // Workspace trust (#121). Resolve AFTER the global merge so a
        // GLOBAL-config `trustedDirectories` allowlist is honored, but BEFORE
        // any project-local fragment is merged. Deny-by-default: an untrusted
        // directory's local config cannot spawn MCP/LSP/plugins, override
        // providers/permissions, or expand {file:}/{env:}.
        const trustAllowlist = global.trustedDirectories
        const trust = yield* ConfigTrust.decideWith(fs, ctx.directory, trustAllowlist)
        const strippedLocalKeys = new Set<string>()

        // Merge one project-local fragment, neutralizing dangerous keys when the
        // workspace is untrusted. `next` was loaded with substitution suppressed
        // for untrusted dirs, so `{file:}`/`{env:}` in it never resolved.
        const mergeLocal = (source: string, next: Info) => {
          if (trust.trusted) return merge(source, next, "local")
          const { config, stripped } = ConfigTrust.neutralizeLocalFragment(next as Record<string, unknown>)
          for (const key of stripped) strippedLocalKeys.add(key)
          if (stripped.length) log.warn("ignoring untrusted project config keys", { source, stripped })
          return merge(source, config as Info, "local")
        }
        const localTrust = trust.trusted ? ("trusted" as const) : ("untrusted" as const)

        if (Flag.AIXPLAIN_CODE_CONFIG) {
          yield* merge(Flag.AIXPLAIN_CODE_CONFIG, yield* loadFile(Flag.AIXPLAIN_CODE_CONFIG))
          log.debug("loaded custom config", { path: Flag.AIXPLAIN_CODE_CONFIG })
        }

        if (!Flag.AIXPLAIN_CODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("aixplainCode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* mergeLocal(file, yield* loadFile(file, localTrust))
          }
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.AIXPLAIN_CODE_CONFIG_DIR) {
          log.debug("loading config from AIXPLAIN_CODE_CONFIG_DIR", { path: Flag.AIXPLAIN_CODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void, never>[] = []

        for (const dir of directories) {
          if (dir.endsWith(".aixplain-code") || dir === Flag.AIXPLAIN_CODE_CONFIG_DIR) {
            // A `.aixplain-code` dir inside the opened project is project-local
            // and must be gated by trust; global/user `.aixplain-code` dirs are
            // not. `containsPath` defines the project boundary (#121).
            const dirIsLocal = containsPath(dir, ctx)
            for (const file of ["aixplainCode.json", "aixplainCode.jsonc"]) {
              const source = path.join(dir, file)
              log.debug(`loading config from ${source}`)
              if (dirIsLocal) yield* mergeLocal(source, yield* loadFile(source, localTrust))
              else yield* merge(source, yield* loadFile(source))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@aixplain/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.sync(() => {
                      log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                    })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          // #121: auto-discovered commands, agents and modes from a project-local
          // `.aixplain-code` dir are directives sourced from the opened repo. An
          // agent/mode `.md` can loosen the permission gate (permission/tools
          // frontmatter) and inject an arbitrary system prompt; a command can pin
          // an arbitrary agent/model. Skip them for an untrusted local dir, the
          // same boundary the plugin auto-discovery below uses. Global/user
          // `.aixplain-code` dirs (outside the project) are always loaded.
          const dirTrusted = trust.trusted || !containsPath(dir, ctx)
          if (dirTrusted) {
            result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
            result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
            result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
          } else {
            // Load only to detect + report what was ignored; nothing here runs
            // the directives (no prompt applied, no permission merged, no process
            // spawned). Tolerate a malformed untrusted repo so it cannot turn the
            // skip path into a startup crash.
            const [commands, agents, modes] = yield* Effect.promise(() =>
              Promise.all([
                ConfigCommand.load(dir).catch(() => ({}) as Record<string, unknown>),
                ConfigAgent.load(dir).catch(() => ({}) as Record<string, unknown>),
                ConfigAgent.loadMode(dir).catch(() => ({}) as Record<string, unknown>),
              ]),
            )
            if (Object.keys(commands).length) strippedLocalKeys.add("command")
            if (Object.keys(agents).length || Object.keys(modes).length) strippedLocalKeys.add("agent")
            const skipped = Object.keys(commands).length + Object.keys(agents).length + Object.keys(modes).length
            if (skipped)
              log.warn("ignoring auto-discovered commands/agents/modes from untrusted project dir", { dir, skipped })
          }
          // Auto-discovered plugins under `.aixplain-code/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          // #121: skip auto-discovered plugins from an untrusted project dir —
          // they would be import()-ed (arbitrary code execution).
          if (dirTrusted) {
            const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
            yield* mergePluginOrigins(dir, list)
          } else {
            const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
            if (list.length) {
              strippedLocalKeys.add("plugin")
              log.warn("ignoring auto-discovered plugins from untrusted project dir", { dir, count: list.length })
            }
          }
        }

        if (process.env.AIXPLAIN_CODE_CONFIG_CONTENT) {
          const source = "AIXPLAIN_CODE_CONFIG_CONTENT"
          const next = yield* loadConfig(
            process.env.AIXPLAIN_CODE_CONFIG_CONTENT,
            { dir: ctx.directory, source },
            localTrust,
          )
          yield* mergeLocal(source, next)
          log.debug("loaded custom config from AIXPLAIN_CODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["AIXPLAIN_CODE_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("AIXPLAIN_CODE_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                dir: path.dirname(source),
                source,
              })
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) => {
              log.debug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              })
              return Effect.void
            }),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["aixplainCode.json", "aixplainCode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          result = mergeConfigConcatArrays(
            result,
            yield* loadConfig(managed.text, {
              dir: path.dirname(managed.source),
              source: managed.source,
            }),
          )
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.AIXPLAIN_CODE_PERMISSION) {
          result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.AIXPLAIN_CODE_PERMISSION))
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermission.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermission.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) result.username = os.userInfo().username

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        if (Flag.AIXPLAIN_CODE_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.AIXPLAIN_CODE_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }

        return {
          config: result,
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
          // Workspace-trust outcome (#121) for the UI layer to surface a notice.
          // Present and untrusted-with-stripped-keys ⇒ the workspace has ignored
          // local config; consumers can offer to trust it.
          trust: {
            trusted: trust.trusted,
            directory: ctx.directory,
            stripped: Array.from(strippedLocalKeys),
          },
        }
      },
      Effect.provideService(AppFileSystem.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const getTrust = Effect.fn("Config.getTrust")(function* () {
      return yield* InstanceState.use(state, (s) => s.trust)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const patch = writableGlobal(config)

      let next: Info
      let changed: boolean
      if (!file.endsWith(".jsonc")) {
        const existing = parseConfig(ConfigParse.jsonc(before, file), file)
        const merged = mergeDeep(writable(existing), patch)
        const serialized = JSON.stringify(merged, null, 2)
        changed = serialized !== before
        if (changed) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
        next = merged
      } else {
        const updated = patchJsonc(before, patch)
        next = parseConfig(ConfigParse.jsonc(updated, file), file)
        changed = updated !== before
        if (changed) yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      if (changed) yield* invalidate()
      return { info: next, changed }
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      getTrust,
      updateGlobal,
      invalidate,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)

export * as Config from "./config"
