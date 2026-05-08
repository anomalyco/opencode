import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "node:url"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Global } from "@opencode-ai/core/global"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool/truncate"
import { RepoCloneTool } from "../../src/tool/repo_clone"
import { disposeAllInstances, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
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

const init = Effect.fn("RepoCloneToolTest.init")(function* () {
  const info = yield* RepoCloneTool
  return yield* info.init()
})

const git = Effect.fn("RepoCloneToolTest.git")(function* (cwd: string, args: string[]) {
  return yield* Effect.promise(async () => {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
    }
    return stdout.trim()
  })
})

const githubBase = <A, E, R>(url: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL
      process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL = url
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        if (previous) process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL = previous
        else delete process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL
      }),
  )

describe("tool.repo_clone", () => {
  it.live("clones a repo into the managed cache and reuses it on subsequent calls", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const source = yield* tmpdirScoped({ git: true })
        const remoteRoot = yield* tmpdirScoped()
        const remoteDir = path.join(remoteRoot, "owner")
        const remoteRepo = path.join(remoteDir, "repo.git")

        yield* Effect.promise(() => Bun.write(path.join(source, "README.md"), "v1\n"))
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "add readme"])
        yield* fs.makeDirectory(remoteDir, { recursive: true }).pipe(Effect.orDie)
        yield* git(remoteRoot, ["clone", "--bare", source, remoteRepo])

        const tool = yield* init()
        const cloned = yield* githubBase(`file://${remoteRoot}/`, tool.execute({ repository: "owner/repo" }, ctx))
        const cached = yield* githubBase(
          `file://${remoteRoot}/`,
          tool.execute({ repository: "https://github.com/owner/repo.git" }, ctx),
        )

        expect(cloned.metadata.status).toBe("cloned")
        expect(cloned.metadata.localPath).toBe(path.join(Global.Path.repos, "github.com", "owner", "repo"))
        expect(cached.metadata.status).toBe("cached")
        expect(yield* fs.readFileString(path.join(cloned.metadata.localPath, "README.md"))).toBe("v1\n")
      }),
    ),
  )

  it.live("refresh updates an existing cached clone", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const source = yield* tmpdirScoped({ git: true })
        const remoteRoot = yield* tmpdirScoped()
        const remoteDir = path.join(remoteRoot, "owner")
        const remoteRepo = path.join(remoteDir, "repo.git")

        yield* Effect.promise(() => Bun.write(path.join(source, "README.md"), "v1\n"))
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "add readme"])
        yield* fs.makeDirectory(remoteDir, { recursive: true }).pipe(Effect.orDie)
        yield* git(remoteRoot, ["clone", "--bare", source, remoteRepo])

        const branch = yield* git(source, ["branch", "--show-current"])
        yield* git(source, ["remote", "add", "origin", remoteRepo])
        yield* git(source, ["push", "-u", "origin", `${branch}:${branch}`])

        const tool = yield* init()
        const first = yield* githubBase(`file://${remoteRoot}/`, tool.execute({ repository: "owner/repo" }, ctx))

        yield* Effect.promise(() => Bun.write(path.join(source, "README.md"), "v2\n"))
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "update readme"])
        yield* git(source, ["push", "origin", `${branch}:${branch}`])

        const refreshed = yield* githubBase(
          `file://${remoteRoot}/`,
          tool.execute({ repository: "owner/repo", refresh: true }, ctx),
        )

        expect(first.metadata.status).toBe("cloned")
        expect(refreshed.metadata.status).toBe("refreshed")
        expect(yield* fs.readFileString(path.join(first.metadata.localPath, "README.md"))).toBe("v2\n")
      }),
    ),
  )

  it.live("clones a configured branch", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const source = yield* tmpdirScoped({ git: true })
        const remoteRoot = yield* tmpdirScoped()
        const remoteDir = path.join(remoteRoot, "owner")
        const remoteRepo = path.join(remoteDir, "repo.git")

        yield* Effect.promise(() => Bun.write(path.join(source, "README.md"), "main\n"))
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "add readme"])
        yield* git(source, ["checkout", "-b", "docs"])
        yield* Effect.promise(() => Bun.write(path.join(source, "DOCS.md"), "docs\n"))
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "add docs"])
        yield* fs.makeDirectory(remoteDir, { recursive: true }).pipe(Effect.orDie)
        yield* git(remoteRoot, ["clone", "--bare", source, remoteRepo])

        const tool = yield* init()
        const result = yield* githubBase(
          `file://${remoteRoot}/`,
          tool.execute({ repository: "owner/repo", branch: "docs" }, ctx),
        )

        expect(result.metadata.status).toBe("cloned")
        expect(result.metadata.branch).toBe("docs")
        expect(yield* fs.readFileString(path.join(result.metadata.localPath, "DOCS.md"))).toBe("docs\n")
      }),
    ),
  )

  it.live("rejects invalid repository inputs", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const tool = yield* init()
        const inputs = [
          { repository: "not-a-repo", message: "git URL" },
          { repository: "git@github.com:../../../etc/passwd", message: "git URL" },
          { repository: "-u:foo/bar", message: "git URL" },
          { repository: pathToFileURL(path.join(_dir, "local.git")).href, message: "Local file" },
        ]

        yield* Effect.forEach(
          inputs,
          (input) =>
            Effect.gen(function* () {
              const result = yield* tool.execute({ repository: input.repository }, ctx).pipe(Effect.exit)

              expect(Exit.isFailure(result)).toBe(true)
              if (Exit.isFailure(result)) {
                const error = Cause.squash(result.cause)
                expect(error instanceof Error ? error.message : String(error)).toContain(input.message)
              }
            }),
          { discard: true },
        )
      }),
    ),
  )

  it.live("rejects local file repository URLs", () =>
    provideTmpdirInstance((_dir) =>
      Effect.gen(function* () {
        const source = yield* tmpdirScoped({ git: true })
        const tool = yield* init()
        const result = yield* tool.execute({ repository: pathToFileURL(source).href }, ctx).pipe(Effect.exit)

        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause)
          expect(error instanceof Error ? error.message : String(error)).toContain("Local file")
        }
      }),
    ),
  )
})
