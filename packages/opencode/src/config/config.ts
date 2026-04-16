import { Log } from "../util"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { mergeDeep, pipe } from "remeda"
import { Global } from "../global"
import fsNode from "fs/promises"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { Instance, type InstanceContext } from "../project/instance"
import * as LSPServer from "../lsp/server"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { Account } from "@/account"
import { isRecord } from "@/util/record"
import { InvalidError, JsonError } from "./error"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { InstanceState } from "@/effect"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option } from "effect"
import { EffectFlock } from "@opencode-ai/shared/util/effect-flock"
import { InstanceRef } from "@/effect/instance-ref"
import { Npm } from "@opencode-ai/shared/npm"
import { ConfigAgent } from "./agent"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigPlugin } from "./plugin"
import { ConfigManaged } from "./managed"
import { ConfigCommand } from "./command"
import { ConfigParse } from "./parse"
import { ConfigPermission } from "./permission"
import { ConfigProvider } from "./provider"
import { ConfigSkills } from "./skills"
import { ConfigPaths } from "./paths"

const log = Log.create({ service: "config" })

// Custom merge function that concatenates array fields instead of replacing them
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
  return copy
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

export const Server = z
  .object({
    port: z.number().int().positive().optional().describe("Port to listen on"),
    hostname: z.string().optional().describe("Hostname to listen on"),
    mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
    mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service (default: opencode.local)"),
    cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
  })
  .strict()
  .meta({
    ref: "ServerConfig",
  })

export const Layout = z.enum(["auto", "stretch"]).meta({
  ref: "LayoutConfig",
})
export type Layout = z.infer<typeof Layout>

export const Info = z
  .object({
    $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
    logLevel: Log.Level.optional().describe("Log level"),
    server: Server.optional().describe("Server configuration for opencode serve and web commands"),
    command: z
      .record(z.string(), ConfigCommand.Info)
      .optional()
      .describe("Command configuration, see https://opencode.ai/docs/commands"),
    skills: ConfigSkills.Info.optional().describe("Additional skill folder paths"),
    watcher: z
      .object({
        ignore: z.array(z.string()).optional(),
      })
      .optional(),
    snapshot: z
      .boolean()
      .optional()
      .describe(
        "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
      ),
    // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
    plugin: ConfigPlugin.Spec.array().optional(),
    share: z
      .enum(["manual", "auto", "disabled"])
      .optional()
      .describe(
        "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
      ),
    autoshare: z
      .boolean()
      .optional()
      .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
    autoupdate: z
      .union([z.boolean(), z.literal("notify")])
      .optional()
      .describe(
        "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
      ),
    disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
    enabled_providers: z
      .array(z.string())
      .optional()
      .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
    model: ConfigModelID.describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
    small_model: ConfigModelID.describe(
      "Small model to use for tasks like title generation in the format of provider/model",
    ).optional(),
    default_agent: z
      .string()
      .optional()
      .describe(
        "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
      ),
    username: z.string().optional().describe("Custom username to display in conversations instead of system username"),
    mode: z
      .object({
        build: ConfigAgent.Info.optional(),
        plan: ConfigAgent.Info.optional(),
      })
      .catchall(ConfigAgent.Info)
      .optional()
      .describe("@deprecated Use `agent` field instead."),
    agent: z
      .object({
        // primary
        plan: ConfigAgent.Info.optional(),
        build: ConfigAgent.Info.optional(),
        // subagent
        general: ConfigAgent.Info.optional(),
        explore: ConfigAgent.Info.optional(),
        // specialized
        title: ConfigAgent.Info.optional(),
        summary: ConfigAgent.Info.optional(),
        compaction: ConfigAgent.Info.optional(),
      })
      .catchall(ConfigAgent.Info)
      .optional()
      .describe("Agent configuration, see https://opencode.ai/docs/agents"),
    provider: z
      .record(z.string(), ConfigProvider.Info)
      .optional()
      .describe("Custom provider configurations and model overrides"),
    mcp: z
      .record(
        z.string(),
        z.union([
          ConfigMCP.Info,
          z
            .object({
              enabled: z.boolean(),
            })
            .strict(),
        ]),
      )
      .optional()
      .describe("MCP (Model Context Protocol) server configurations"),
    formatter: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        ),
      ])
      .optional(),
    lsp: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.union([
            z.object({
              disabled: z.literal(true),
            }),
            z.object({
              command: z.array(z.string()),
              extensions: z.array(z.string()).optional(),
              disabled: z.boolean().optional(),
              env: z.record(z.string(), z.string()).optional(),
              initialization: z.record(z.string(), z.any()).optional(),
            }),
          ]),
        ),
      ])
      .optional()
      .refine(
        (data) => {
          if (!data) return true
          if (typeof data === "boolean") return true
          const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

          return Object.entries(data).every(([id, config]) => {
            if (config.disabled) return true
            if (serverIds.has(id)) return true
            return Boolean(config.extensions)
          })
        },
        {
          error: "For custom LSP servers, 'extensions' array is required.",
        },
      ),
    instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
    layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
    permission: ConfigPermission.Info.optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    enterprise: z
      .object({
        url: z.string().optional().describe("Enterprise URL"),
      })
      .optional(),
    compaction: z
      .object({
        auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
        prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
        reserved: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Token buffer for compaction. Leaves enough window to avoid overflow during compaction."),
      })
      .optional(),
    experimental: z
      .object({
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional().describe("Enable the batch tool"),
        openTelemetry: z
          .boolean()
          .optional()
          .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
        primary_tools: z
          .array(z.string())
          .optional()
          .describe("Tools that should only be available to primary agents."),
        continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        mcp_timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
      })
      .optional(),
  })
  .strict()
  .meta({
    ref: "Config",
  })

export type Info = z.output<typeof Info> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<Info>
  readonly invalidate: (wait?: boolean) => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

function globalConfigFile() {
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
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

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJsonc(result, value, [...path, key])
  }, input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

export const ConfigDirectoryTypoError = NamedError.create(
  "ConfigDirectoryTypoError",
  z.object({
    path: z.string(),
    dir: z.string(),
    suggestion: z.string(),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
        Effect.orDie,
      )
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      if (!("path" in options)) {
        return yield* Effect.promise(() =>
          ConfigParse.load(Info, text, {
            type: "virtual",
            dir: options.dir,
            source: options.source,
            normalize: normalizeLoadedConfig,
          }),
        )
      }

      const data = yield* Effect.promise(() =>
        ConfigParse.load(Info, text, {
          type: "path",
          path: options.path,
          normalize: normalizeLoadedConfig,
        }),
      )
      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://opencode.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = pipe(
        {},
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "config.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.json"))),
        mergeDeep(yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"))),
      )

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://opencode.ai/config.json"
              result = mergeDeep(result, rest)
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

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(function* (ctx: InstanceContext) {
      const auth = yield* authSvc.all().pipe(Effect.orDie)

      let result: Info = {}
      const consoleManagedProviders = new Set<string>()
      let activeOrgName: string | undefined

      const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
        if (source.startsWith("http://") || source.startsWith("https://")) return "global"
        if (source === "OPENCODE_CONFIG_CONTENT") return "local"
        if (yield* InstanceRef.use((ctx) => Effect.succeed(Instance.containsPath(source, ctx)))) return "local"
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
          log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
          const response = yield* Effect.promise(() => fetch(`${url}/.well-known/opencode`))
          if (!response.ok) {
            throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
          }
          const wellknown = (yield* Effect.promise(() => response.json())) as any
          const remoteConfig = wellknown.config ?? {}
          if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
          const source = `${url}/.well-known/opencode`
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

      if (Flag.OPENCODE_CONFIG) {
        yield* merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG))
        log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
      }

      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        for (const file of yield* Effect.promise(() =>
          ConfigPaths.projectFiles("opencode", ctx.directory, ctx.worktree),
        )) {
          yield* merge(file, yield* loadFile(file), "local")
        }
      }

      result.agent = result.agent || {}
      result.mode = result.mode || {}
      result.plugin = result.plugin || []

      const directories = yield* Effect.promise(() => ConfigPaths.directories(ctx.directory, ctx.worktree))

      if (Flag.OPENCODE_CONFIG_DIR) {
        log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
      }

      const deps: Fiber.Fiber<void, never>[] = []

      for (const dir of directories) {
        if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(dir, file)
            log.debug(`loading config from ${source}`)
            yield* merge(source, yield* loadFile(source))
            result.agent ??= {}
            result.mode ??= {}
            result.plugin ??= []
          }
        }

        yield* ensureGitignore(dir).pipe(Effect.orDie)

        const dep = yield* npmSvc
          .install(dir, {
            add: ["@opencode-ai/plugin" + (InstallationLocal ? "" : "@" + InstallationVersion)],
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

        result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
        result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
        result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
        // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
        // returns normalized Specs and we only need to attach origin metadata here.
        const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
        yield* mergePluginOrigins(dir, list)
      }

      if (process.env.OPENCODE_CONFIG_CONTENT) {
        const source = "OPENCODE_CONFIG_CONTENT"
        const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
          dir: ctx.directory,
          source,
        })
        yield* merge(source, next, "local")
        log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
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
            process.env["OPENCODE_CONSOLE_TOKEN"] = tokenOpt.value
            yield* env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)
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
        for (const file of ["opencode.json", "opencode.jsonc"]) {
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

      if (Flag.OPENCODE_PERMISSION) {
        result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
      }

      if (result.tools) {
        const perms: Record<string, ConfigPermission.Action> = {}
        for (const [tool, enabled] of Object.entries(result.tools)) {
          const action: ConfigPermission.Action = enabled ? "allow" : "deny"
          if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
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

      if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
        result.compaction = { ...result.compaction, auto: false }
      }
      if (Flag.OPENCODE_DISABLE_PRUNE) {
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
      }
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx)
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

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      yield* fs
        .writeFileString(file, JSON.stringify(mergeDeep(writable(existing), writable(config)), null, 2))
        .pipe(Effect.orDie)
      yield* Effect.promise(() => Instance.dispose())
    })

    const invalidate = Effect.fn("Config.invalidate")(function* (wait?: boolean) {
      yield* invalidateGlobal
      const task = Instance.disposeAll()
        .catch(() => undefined)
        .finally(() =>
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Event.Disposed.type,
              properties: {},
            },
          }),
        )
      if (wait) yield* Effect.promise(() => task)
      else void task
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const input = writable(config)

      let next: Info
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.parse(Info, before, file)
        const merged = mergeDeep(writable(existing), input)
        yield* fs.writeFileString(file, JSON.stringify(merged, null, 2)).pipe(Effect.orDie)
        next = merged
      } else {
        const updated = patchJsonc(before, input)
        next = ConfigParse.parse(Info, updated, file)
        yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      yield* invalidate()
      return next
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
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
