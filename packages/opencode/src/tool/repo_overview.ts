import path from "path"
import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Git } from "@/git"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./repo_overview.txt"
import * as Tool from "./tool"
import { parseRepositoryReference, repositoryCachePath } from "@/util/repository"
import { Instance } from "@/project/instance"

export const Parameters = Schema.Struct({
  repository: Schema.optional(Schema.String).annotate({
    description: "Cached repository to inspect, as a git URL, host/path reference, or GitHub owner/repo shorthand",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Directory path to inspect instead of a cached repository",
  }),
  depth: Schema.optional(Schema.Number).annotate({
    description: "Maximum structure depth to include. Defaults to 3.",
  })
})

type Metadata = {
  path: string
  repository?: string
  branch?: string
  head?: string
  package_manager?: string
  ecosystems: string[]
  dependency_files: string[]
  entrypoints: string[]
  depth: number
  truncated: boolean
}

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", "build", ".next", "target", "vendor"])
const STRUCTURE_LIMIT = 200
const DEPENDENCY_FILES = [
  "package.json",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "composer.json",
]

function packageManager(files: Set<string>) {
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun"
  if (files.has("pnpm-lock.yaml")) return "pnpm"
  if (files.has("yarn.lock")) return "yarn"
  if (files.has("package-lock.json")) return "npm"
}

function ecosystems(files: Set<string>) {
  return [
    ...(files.has("package.json") ? ["Node.js"] : []),
    ...(files.has("pyproject.toml") || files.has("requirements.txt") ? ["Python"] : []),
    ...(files.has("go.mod") ? ["Go"] : []),
    ...(files.has("Cargo.toml") ? ["Rust"] : []),
    ...(files.has("Gemfile") ? ["Ruby"] : []),
    ...(files.has("build.gradle") || files.has("build.gradle.kts") || files.has("pom.xml") ? ["Java/Kotlin"] : []),
    ...(files.has("composer.json") ? ["PHP"] : []),
  ]
}

function commonEntrypoints(files: Set<string>) {
  return ["index.ts", "index.tsx", "index.js", "index.mjs", "main.ts", "main.js", "src/index.ts", "src/index.tsx", "src/index.js", "src/main.ts", "src/main.js"].filter((file) => files.has(file))
}

export const RepoOverviewTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service | Git.Service>(
  "repo_overview",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service

    const resolveTarget = Effect.fn("RepoOverviewTool.resolveTarget")(function* (params: Schema.Schema.Type<typeof Parameters>) {
      if (params.path) {
        const full = path.isAbsolute(params.path) ? params.path : path.resolve(Instance.directory, params.path)
        return { path: full, repository: params.repository }
      }

      if (!params.repository) throw new Error("Either repository or path is required")

      const parsed = parseRepositoryReference(params.repository)
      if (!parsed) throw new Error("Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand")

      const repository = parsed.label
      return {
        repository,
        path: repositoryCachePath(parsed),
      }
    })

    const structure = Effect.fn("RepoOverviewTool.structure")(function* (root: string, depth: number) {
      let truncated = false
      const lines: string[] = []

      const visit: (dir: string, level: number) => Effect.Effect<void> = Effect.fnUntraced(function* (dir: string, level: number) {
        if (level >= depth || lines.length >= STRUCTURE_LIMIT) {
          truncated = truncated || lines.length >= STRUCTURE_LIMIT
          return
        }

        const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.orElseSucceed(() => []))
        const sorted = yield* Effect.forEach(
          entries,
          Effect.fnUntraced(function* (entry) {
            if (IGNORED_DIRS.has(entry.name)) return undefined
            const full = path.join(dir, entry.name)
            const info = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!info) return undefined
            return { name: entry.name, full, directory: info.type === "Directory" }
          }),
          { concurrency: 16 },
        ).pipe(
          Effect.map((items) =>
            items
              .filter((item): item is { name: string; full: string; directory: boolean } => Boolean(item))
              .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)),
          ),
        )

        for (const entry of sorted) {
          if (lines.length >= STRUCTURE_LIMIT) {
            truncated = true
            return
          }

          lines.push(`${"  ".repeat(level)}${entry.name}${entry.directory ? "/" : ""}`)
          if (entry.directory) yield* visit(entry.full, level + 1)
        }
      })

      yield* visit(root, 0)
      return { lines, truncated }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const target = yield* resolveTarget(params)
          const depth = !params.depth || !Number.isInteger(params.depth) || params.depth < 1 || params.depth > 6 ? 3 : params.depth

          yield* assertExternalDirectoryEffect(ctx, target.path, { kind: "directory" })
          yield* ctx.ask({
            permission: "repo_overview",
            patterns: [target.repository ?? target.path],
            always: [target.repository ?? target.path],
            metadata: {
              repository: target.repository,
              path: target.path,
              depth,
            },
          })

          const info = yield* fs.stat(target.path).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) {
            if (target.repository) throw new Error(`Repository is not cloned: ${target.repository}. Use repo_clone first.`)
            throw new Error(`Directory not found: ${target.path}`)
          }
          if (info.type !== "Directory") throw new Error(`Path is not a directory: ${target.path}`)

          const entries = yield* fs.readDirectoryEntries(target.path).pipe(Effect.orElseSucceed(() => []))
          const topLevel = new Set(entries.map((entry) => entry.name))
          const dependencyFiles = DEPENDENCY_FILES.filter((file) => topLevel.has(file))
          const packageJson = topLevel.has("package.json")
            ? (yield* fs.readJson(path.join(target.path, "package.json")).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
            : {}

          const entrypoints = [
            ...(typeof packageJson.main === "string" ? [`main: ${packageJson.main}`] : []),
            ...(typeof packageJson.module === "string" ? [`module: ${packageJson.module}`] : []),
            ...(typeof packageJson.types === "string" ? [`types: ${packageJson.types}`] : []),
            ...(typeof packageJson.bin === "string" ? [`bin: ${packageJson.bin}`] : []),
            ...(packageJson.bin && typeof packageJson.bin === "object" && !Array.isArray(packageJson.bin)
              ? Object.keys(packageJson.bin as Record<string, unknown>).map((name) => `bin: ${name}`)
              : []),
            ...(packageJson.exports && typeof packageJson.exports === "object" && !Array.isArray(packageJson.exports)
              ? Object.keys(packageJson.exports as Record<string, unknown>).slice(0, 10).map((name) => `exports: ${name}`)
              : []),
          ]

          const common = commonEntrypoints(new Set([
            ...topLevel,
            ...entries
              .filter((entry) => entry.name === "src")
              .flatMap(() => ["src/index.ts", "src/index.tsx", "src/index.js", "src/main.ts", "src/main.js"]),
          ]))
          const structureResult = yield* structure(target.path, depth)
          const branch = yield* git.branch(target.path)
          const head = yield* git.run(["rev-parse", "HEAD"], { cwd: target.path })
          const headText = head.exitCode === 0 ? head.text().trim() : undefined

          const metadata: Metadata = {
            path: target.path,
            repository: target.repository,
            branch,
            head: headText,
            package_manager: packageManager(topLevel),
            ecosystems: ecosystems(topLevel),
            dependency_files: dependencyFiles,
            entrypoints: [...entrypoints, ...common.map((file) => `file: ${file}`)],
            depth,
            truncated: structureResult.truncated,
          }

          return {
            title: target.repository ?? path.basename(target.path),
            metadata,
            output: [
              `Path: ${target.path}`,
              ...(target.repository ? [`Repository: ${target.repository}`] : []),
              ...(branch ? [`Branch: ${branch}`] : []),
              ...(headText ? [`HEAD: ${headText}`] : []),
              ...(metadata.ecosystems.length ? [`Ecosystems: ${metadata.ecosystems.join(", ")}`] : []),
              ...(metadata.package_manager ? [`Package manager: ${metadata.package_manager}`] : []),
              ...(metadata.dependency_files.length ? [`Dependency files: ${metadata.dependency_files.join(", ")}`] : []),
              ...(metadata.entrypoints.length ? ["Likely entrypoints:", ...metadata.entrypoints.map((entry) => `- ${entry}`)] : []),
              "Top-level structure:",
              ...structureResult.lines,
              ...(structureResult.truncated ? ["(Structure truncated)"] : []),
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
