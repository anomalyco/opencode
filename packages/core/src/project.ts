export * as Project from "./project"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppFileSystem } from "./filesystem"
import { AppProcess } from "./process"
import { AbsolutePath, withStatics } from "./schema"
import type { Location } from "./location"

export const ID = Schema.String.pipe(
  Schema.brand("AccountV2.ID"),
  withStatics((schema) => ({
    global: schema.make("global"),
  })),
)
export type ID = typeof ID.Type

export interface Interface {
  readonly create: (input: AbsolutePath) => Promise<ID>
  readonly locations: (projectID: ID) => Promise<Location.Ref[]>
  // opencode -> ["~/dev/projects/anomalyco/opencode", "~/.gitworktrees/anomalyci/opencode"]
  // global -> ["~/.config/nvim", "/etc/nixos"]

  readonly resolve: (input: AbsolutePath) => Promise<ID>
  // ~/dev/projects/anomalyco/opencode -> opencode
  // ~/dev/projects/anomalyco/opencode/packages/core -> opencode
  // ~/.gitworktrees/anomalyci/opencode -> opencode
  // ~/.config/nvim -> global
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

interface GitResult {
  readonly exitCode: number
  readonly text: () => string
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const proc = yield* AppProcess.Service

    const runGit = Effect.fn("Project.git")(
      function* (args: string[], cwd: string) {
        const result = yield* proc.run(
          ChildProcess.make("git", args, {
            cwd,
            extendEnv: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }),
        )
        return {
          exitCode: result.exitCode,
          text: () => result.stdout.toString("utf8"),
        } satisfies GitResult
      },
      Effect.catch(() =>
        Effect.succeed({
          exitCode: 1,
          text: () => "",
        } satisfies GitResult),
      ),
    )

    const resolveGitPath = (cwd: string, value: string) => {
      const trimmed = value.replace(/[\r\n]+$/, "")
      if (!trimmed) return cwd
      const normalized = AppFileSystem.windowsPath(trimmed)
      if (path.isAbsolute(normalized)) return path.normalize(normalized)
      return path.resolve(cwd, normalized)
    }

    const readCachedProjectId = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((x) => x.trim()),
        Effect.map((x) => ID.make(x)),
        Effect.catch(() => Effect.void),
      )
    })

    const resolve = async (input: AbsolutePath) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const repoPath = yield* fs.up({ targets: [".git"], start: input }).pipe(
            Effect.map((matches) => matches[0]),
            Effect.catch(() => Effect.void),
          )
          if (!repoPath) return ID.global

          const cwd = path.dirname(repoPath)
          const parsed = yield* runGit(["rev-parse", "--git-dir", "--git-common-dir"], cwd)
          if (parsed.exitCode !== 0) return (yield* readCachedProjectId(repoPath)) ?? ID.global

          const gitPaths = parsed
            .text()
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean)
          const commonDir = gitPaths[1] ? resolveGitPath(cwd, gitPaths[1]) : undefined
          if (!commonDir) return (yield* readCachedProjectId(repoPath)) ?? ID.global

          const cached = (yield* readCachedProjectId(repoPath)) ?? (yield* readCachedProjectId(commonDir))
          if (cached) return cached

          const id = (yield* runGit(["rev-list", "--max-parents=0", "HEAD"], cwd))
            .text()
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
            .toSorted()[0]

          if (!id) return ID.global
          yield* fs.writeFileString(path.join(commonDir, "opencode"), id).pipe(Effect.ignore)
          return ID.make(id)
        }),
      )

    return Service.of({
      create: async () => {
        throw new Error("Project.create is not implemented")
      },
      locations: async () => [],
      resolve,
    })
  }),
)
