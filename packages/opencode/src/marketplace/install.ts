import path from "path"
import { Effect, Layer, Context, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"

export class Assets extends Schema.Class<Assets>("Marketplace.Assets")({
  skills: Schema.Array(Schema.String),
  agents: Schema.Array(Schema.String),
  tools: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
  plugins: Schema.Array(Schema.String),
  mcpServers: Schema.Array(Schema.String),
}) {}

export interface InstallResult {
  readonly assets: Assets
  readonly targetDir: string
}

export interface Interface {
  readonly discover: (dir: string) => Effect.Effect<Assets>
  readonly install: (pkgName: string, installDir: string) => Effect.Effect<InstallResult>
  readonly uninstall: (pkgName: string, installDir: string, assets: Assets) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceInstall") {}

const scanFiles = (dir: string, pattern: string): Effect.Effect<string[]> =>
  Effect.tryPromise({
    try: () => Glob.scan(pattern, { cwd: dir, absolute: true }),
    catch: () => [] as string[],
  }).pipe(Effect.catch(() => Effect.succeed([] as string[])))

const readPluginDirs = (dir: string): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const pkgFiles = yield* scanFiles(dir, "package.json")
    const result: string[] = []
    for (const pkgFile of pkgFiles) {
      const data = yield* Effect.tryPromise({
        try: () => import("fs/promises").then((f) => f.readFile(pkgFile, "utf-8").then(JSON.parse)),
        catch: () => null as Record<string, unknown> | null,
      }).pipe(Effect.catch(() => Effect.succeed(null as Record<string, unknown> | null)))
      if (data) {
        const exports = data.exports as Record<string, unknown> | undefined
        if (exports?.["./server"] || exports?.["./tui"]) {
          result.push(path.dirname(pkgFile))
        }
      }
    }
    return result
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const discover: Interface["discover"] = (dir: string) =>
      Effect.gen(function* () {
        const [allSkills, allAgents, allTools, allCommands, allPlugins, allMcp] = yield* Effect.all(
          [
            scanFiles(dir, "**/SKILL.md"),
            scanFiles(dir, "{agents,agent}/**/*.md"),
            scanFiles(dir, "{tools,tool}/**/*.{ts,js}"),
            scanFiles(dir, "{commands,command}/**/*.md"),
            readPluginDirs(dir),
            scanFiles(dir, "mcp.json"),
          ],
          { concurrency: 6 },
        )

        return new Assets({
          skills: allSkills,
          agents: allAgents,
          tools: allTools,
          commands: allCommands,
          plugins: allPlugins,
          mcpServers: allMcp,
        })
      })

    const doInstall: Interface["install"] = (pkgName: string, installDir: string) =>
      Effect.gen(function* () {
        const assets = yield* discover(installDir)

        for (const skillPath of assets.skills) {
          const skillDir = path.dirname(skillPath)
          const skillName = path.basename(skillDir)
          const dest = path.join(global.config, "skills", pkgName, skillName)
          yield* Effect.promise(() =>
            import("fs/promises").then((f) => f.cp(skillDir, dest, { recursive: true })),
          ).pipe(Effect.ignore)
        }
        for (const agentPath of assets.agents) {
          const rel = path.relative(installDir, agentPath)
          yield* copyFile(agentPath, path.join(global.config, "agents", path.basename(rel)), fs).pipe(Effect.ignore)
        }
        for (const toolPath of assets.tools) {
          const rel = path.relative(installDir, toolPath)
          yield* copyFile(toolPath, path.join(global.config, "tools", path.basename(rel)), fs).pipe(Effect.ignore)
        }
        for (const cmdPath of assets.commands) {
          const rel = path.relative(installDir, cmdPath)
          yield* copyFile(cmdPath, path.join(global.config, "commands", path.basename(rel)), fs).pipe(Effect.ignore)
        }

        return { assets, targetDir: installDir }
      })

    const doUninstall: Interface["uninstall"] = (pkgName: string, _installDir: string, assets: Assets) =>
      Effect.gen(function* () {
        if (assets.skills.length > 0) {
          yield* rmDir(path.join(global.config, "skills", pkgName)).pipe(Effect.ignore)
        }
        for (const ap of assets.agents) {
          yield* rmFile(path.join(global.config, "agents", path.basename(ap))).pipe(Effect.ignore)
        }
        for (const tp of assets.tools) {
          yield* rmFile(path.join(global.config, "tools", path.basename(tp))).pipe(Effect.ignore)
        }
        for (const cp of assets.commands) {
          yield* rmFile(path.join(global.config, "commands", path.basename(cp))).pipe(Effect.ignore)
        }
      })

    return Service.of({
      discover,
      install: doInstall,
      uninstall: doUninstall,
    })
  }),
)

const copyFile = (src: string, dest: string, fsys: FSUtil.Interface): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const content = yield* fsys.readFileStringSafe(src).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!content) return false
    yield* fsys.writeWithDirs(dest, content).pipe(Effect.catch(() => Effect.void))
    return true
  })

const rmDir = (dir: string): Effect.Effect<void> =>
  Effect.promise(() => import("fs/promises").then((f) => f.rm(dir, { recursive: true, force: true }))).pipe(
    Effect.catch(() => Effect.void),
  )

const rmFile = (file: string): Effect.Effect<void> =>
  Effect.promise(() => import("fs/promises").then((f) => f.rm(file, { force: true }))).pipe(
    Effect.catch(() => Effect.void),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
)
