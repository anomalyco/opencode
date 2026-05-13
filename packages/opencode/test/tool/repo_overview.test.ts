import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Global } from "@opencode-ai/core/global"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool/truncate"
import { RepoOverviewTool } from "../../src/tool/repo_overview"
import { disposeAllInstances, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "scout",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Git.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const init = Effect.fn("RepoOverviewToolTest.init")(function* () {
  const info = yield* RepoOverviewTool
  return yield* info.init()
})

describe("tool.repo_overview", () => {
  it.live("summarizes a local repository path", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const repo = yield* tmpdirScoped({ git: true })
        const fs = yield* AppFileSystem.Service
        yield* fs.writeWithDirs(
          path.join(repo, "package.json"),
          JSON.stringify(
            {
              name: "example-repo",
              main: "dist/index.js",
              module: "dist/index.mjs",
              types: "dist/index.d.ts",
              exports: {
                ".": "./dist/index.js",
                "./server": "./dist/server.js",
              },
              bin: {
                example: "./bin/example.js",
              },
            },
            null,
            2,
          ),
        )
        yield* fs.writeWithDirs(path.join(repo, "bun.lock"), "")
        yield* fs.writeWithDirs(path.join(repo, "README.md"), "# Example\n")
        yield* fs.writeWithDirs(path.join(repo, "src", "index.ts"), "export const value = 1\n")

        const tool = yield* init()
        const result = yield* tool.execute({ path: repo }, ctx)

        expect(result.metadata.path).toBe(repo)
        expect(result.metadata.ecosystems).toContain("Node.js")
        expect(result.metadata.package_manager).toBe("bun")
        expect(result.metadata.dependency_files).toEqual(expect.arrayContaining(["package.json", "bun.lock"]))
        expect(result.metadata.entrypoints).toEqual(
          expect.arrayContaining([
            "main: dist/index.js",
            "module: dist/index.mjs",
            "types: dist/index.d.ts",
            "exports: .",
            "exports: ./server",
            "bin: example",
            "file: src/index.ts",
          ]),
        )
        expect(result.output).toContain("Top-level structure:")
        expect(result.output).toContain("src/")
        expect(result.output).toContain("README.md")
      }),
    ),
  )

  it.live("resolves a cached repository from repository shorthand", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const cached = path.join(Global.Path.repos, "github.com", "owner", "repo")
        yield* fs.writeWithDirs(path.join(cached, "package.json"), JSON.stringify({ name: "cached-repo" }, null, 2))
        yield* fs.writeWithDirs(path.join(cached, "README.md"), "cached\n")

        const tool = yield* init()
        const result = yield* tool.execute({ repository: "owner/repo" }, ctx)

        expect(result.metadata.path).toBe(cached)
        expect(result.metadata.repository).toBe("owner/repo")
        expect(result.output).toContain("Repository: owner/repo")
        expect(result.output).toContain(`Path: ${cached}`)
      }),
    ),
  )

  it.live("fails clearly when a repository is not cloned", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const tool = yield* init()
        const result = yield* tool.execute({ repository: "missing/repo" }, ctx).pipe(Effect.exit)

        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause)
          expect(error instanceof Error ? error.message : String(error)).toContain("Use repo_clone first")
        }
      }),
    ),
  )

  it.live("resolves cached repositories from host/path references", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const cached = path.join(Global.Path.repos, "gitlab.com", "group", "repo")
        yield* fs.writeWithDirs(path.join(cached, "README.md"), "cached\n")

        const tool = yield* init()
        const result = yield* tool.execute({ repository: "gitlab.com/group/repo" }, ctx)

        expect(result.metadata.path).toBe(cached)
        expect(result.metadata.repository).toBe("gitlab.com/group/repo")
        expect(result.output).toContain("Repository: gitlab.com/group/repo")
      }),
    ),
  )
})
