import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Context } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@/config/config"
import { EvolutionStorageError, toEvolutionStorageError } from "@/evolution/error"
import path from "path"

const IGNORE_DIRS = new Set(["node_modules", ".git", "build", "dist", ".next", ".cache", "target", "vendor", ".venv", "__pycache__"])

const CACHE_TTL_MS = 300_000

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  dart: "Dart",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  c: "C",
  h: "C",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hxx: "C++",
  ex: "Elixir",
  exs: "Elixir",
  zig: "Zig",
  vue: "Vue",
  svelte: "Svelte",
}

const FRAMEWORK_DETECTORS: Array<{ name: string; detect: (files: string[], deps: string[]) => boolean }> = [
  { name: "Next.js", detect: (files) => files.some((f) => f === "next.config.js" || f === "next.config.ts" || f === "next.config.mjs") },
  { name: "Express", detect: (_, deps) => deps.includes("express") },
  { name: "Fastify", detect: (_, deps) => deps.includes("fastify") },
  { name: "React", detect: (_, deps) => deps.includes("react") || deps.includes("react-dom") },
  { name: "Vue", detect: (_, deps) => deps.includes("vue") },
  { name: "Svelte", detect: (_, deps) => deps.includes("svelte") || deps.includes("@sveltejs/kit") },
  { name: "Solid.js", detect: (_, deps) => deps.includes("solid-js") },
  { name: "Angular", detect: (_, deps) => deps.includes("@angular/core") },
  { name: "NestJS", detect: (_, deps) => deps.includes("@nestjs/core") },
  { name: "Django", detect: (_, deps) => deps.includes("django") },
  { name: "Flask", detect: (_, deps) => deps.includes("flask") },
  { name: "FastAPI", detect: (_, deps) => deps.includes("fastapi") },
  { name: "Laravel", detect: (files) => files.includes("artisan") },
  { name: "Drizzle", detect: (_, deps) => deps.includes("drizzle-orm") },
  { name: "Prisma", detect: (_, deps) => deps.includes("@prisma/client") || deps.includes("prisma") },
  { name: "Tailwind CSS", detect: (_, deps) => deps.includes("tailwindcss") },
]

export interface ProjectProfile {
  root: string
  name: string
  vcs: string
  languages: string[]
  frameworks: string[]
  packages: { name: string; version: string; type: "dependency" | "devDependency" }[]
  structure: "single" | "monorepo"
  hasDocker: boolean
  hasTests: boolean
  hasCI: boolean
  detectedAt: number
}

export interface Interface {
  readonly profile: () => Effect.Effect<ProjectProfile, EvolutionStorageError>
  readonly detectFrameworks: () => Effect.Effect<string[], EvolutionStorageError>
  readonly getStructure: () => Effect.Effect<"single" | "monorepo", EvolutionStorageError>
  readonly hasDependency: (name: string) => Effect.Effect<boolean, EvolutionStorageError>
  readonly refresh: () => Effect.Effect<ProjectProfile, EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionProject") {}

function isMonorepoHint(dirName: string): boolean {
  return dirName === "packages" || dirName === "apps" || dirName === "modules"
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service

    const loadProfile = Effect.fn("EvolutionProject.loadProfile")(function* (ctx: { worktree: string }) {
      const { worktree } = ctx

      const gitDir = path.join(worktree, ".git")
      const vcs = yield* fs.exists(gitDir).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "exists", gitDir))),
        Effect.map((e) => (e ? "git" : "unknown")),
      )

      let deps: { name: string; version: string; type: "dependency" | "devDependency" }[] = []
      let files: string[] = []
      const languages = new Set<string>()

      const pkgPath = path.join(worktree, "package.json")
      const pkgRaw = yield* fs.readFileStringSafe(pkgPath).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", pkgPath))),
      )
      let workspaces: string[] = []
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw)
          if (pkg.dependencies) {
            for (const [name, version] of Object.entries(pkg.dependencies)) {
              deps.push({ name, version: String(version), type: "dependency" })
            }
          }
          if (pkg.devDependencies) {
            for (const [name, version] of Object.entries(pkg.devDependencies)) {
              deps.push({ name, version: String(version), type: "devDependency" })
            }
          }
          if (Array.isArray(pkg.workspaces)) workspaces = pkg.workspaces
        } catch (err) { console.error("[ef-ai] Error parsing package.json:", err) }
      }

      const collectDirEntries = Effect.fn("EvolutionProject.collectDirEntries")(function* (dir: string) {
        const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.catch(() => Effect.succeed([])))
        const collected: string[] = []
        const dirs: string[] = []
        for (const e of entries) {
          if (IGNORE_DIRS.has(e.name)) continue
          if (e.type === "file") {
            collected.push(e.name)
            const ext = e.name.split(".").pop()
            if (ext && LANGUAGE_EXTENSIONS[ext]) languages.add(LANGUAGE_EXTENSIONS[ext])
          } else if (e.type === "directory") {
            dirs.push(e.name)
          }
        }
        return { files: collected, dirs }
      })

      const entries = yield* collectDirEntries(worktree)
      files = entries.files

      const readPkgJson = Effect.fn("EvolutionProject.readPkgJson")(function* (dir: string) {
        const pkgJsonPath = path.join(dir, "package.json")
        const raw = yield* fs.readFileStringSafe(pkgJsonPath).pipe(
          Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", pkgJsonPath))),
        )
        if (!raw) return
        try {
          const pkg = JSON.parse(raw)
          if (pkg.dependencies) {
            for (const [name, version] of Object.entries(pkg.dependencies)) {
              deps.push({ name, version: String(version), type: "dependency" })
            }
          }
          if (pkg.devDependencies) {
            for (const [name, version] of Object.entries(pkg.devDependencies)) {
              deps.push({ name, version: String(version), type: "devDependency" })
            }
          }
        } catch { /* ignore */ }
      })

      const scanWorkspaceDeps = Effect.fn("EvolutionProject.scanWorkspaceDeps")(function* () {
        for (const pattern of workspaces) {
          if (pattern.includes("**") || pattern.includes("/*/")) {
            yield* Effect.logWarning(
              `[EF-AI] unsupported glob pattern '${pattern}' — results may be incomplete`
            )
            continue
          }
          const base = path.join(worktree, pattern.replace(/\/\*$/, ""))
          if (pattern.endsWith("/*")) {
            const subdirs = yield* fs.readDirectoryEntries(base).pipe(Effect.catch(() => Effect.succeed([])))
            for (const entry of subdirs) {
              if (entry.type !== "directory") continue
              yield* readPkgJson(path.join(base, entry.name))
            }
          } else {
            yield* readPkgJson(base)
          }
        }
      })
      yield* scanWorkspaceDeps()

      const depNames = deps.map((d) => d.name)
      const detected = FRAMEWORK_DETECTORS.filter((fd) => fd.detect(files, depNames)).map((fd) => fd.name)

      const allNames = [...files, ...entries.dirs]
      const isMonorepo = workspaces.length > 0 || allNames.some((n) => isMonorepoHint(n))

      const hasDocker = allNames.some(
        (f) => f.toLowerCase() === "dockerfile" || f === "docker-compose.yml" || f === "docker-compose.yaml" || f === "compose.yml" || f === "compose.yaml",
      )

      const hasTests = depNames.some(
        (d) => d.includes("jest") || d.includes("vitest") || d.includes("mocha") || d.includes("playwright") || d.includes("cypress") || d.includes("pytest"),
      ) || files.some((f) => f.startsWith("test") || f.startsWith("__tests__") || f.startsWith("spec"))

      const hasCI = allNames.some((f) => f === ".github" || f === ".gitlab-ci.yml" || f === ".circleci" || f === "Jenkinsfile")

      const profile: ProjectProfile = {
        root: worktree,
        name: path.basename(worktree),
        vcs,
        languages: [...languages].sort(),
        frameworks: detected,
        packages: deps,
        structure: isMonorepo ? "monorepo" : "single",
        hasDocker,
        hasTests,
        hasCI,
        detectedAt: Date.now(),
      }

      return profile
    })

    const cacheFilePath = (ctx: { worktree: string }) =>
      path.join(ctx.worktree, ".opencode", "evolution", "project.json")

    const profile = Effect.fn("EvolutionProject.profile")(function* () {
      const ctx = yield* InstanceState.context
      const cfg = yield* config.get()
      if (!cfg.evolution?.enabled) {
        return {
          root: ctx.worktree,
          name: path.basename(ctx.worktree),
          vcs: "unknown",
          languages: [],
          frameworks: [],
          packages: [],
          structure: "single" as const,
          hasDocker: false,
          hasTests: false,
          hasCI: false,
          detectedAt: 0,
        }
      }

      const fp = cacheFilePath(ctx)
      const cached = yield* fs.readFileStringSafe(fp).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", fp))),
      )
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as ProjectProfile
          if (Date.now() - parsed.detectedAt < CACHE_TTL_MS) return parsed
        } catch { /* fall through to refresh */ }
      }

      return yield* refresh()
    })

    const refresh = Effect.fn("EvolutionProject.refresh")(function* () {
      const ctx = yield* InstanceState.context
      const result = yield* loadProfile(ctx)
      const fp = cacheFilePath(ctx)
      yield* fs.writeWithDirs(fp, JSON.stringify(result, null, 2)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", fp))),
      )
      return result
    })

    const detectFrameworks = Effect.fn("EvolutionProject.detectFrameworks")(function* () {
      const p = yield* profile()
      return p.frameworks
    })

    const getStructure = Effect.fn("EvolutionProject.getStructure")(function* () {
      const p = yield* profile()
      return p.structure
    })

    const hasDependency = Effect.fn("EvolutionProject.hasDependency")(function* (name: string) {
      const p = yield* profile()
      return p.packages.some((d) => d.name === name)
    })

    return Service.of({ profile, detectFrameworks, getStructure, hasDependency, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, FSUtil.node])

export * as EvolutionProject from "./project"
