import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Layer, PlatformError } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, testInstanceStoreLayer, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { testEffect } from "../lib/effect"
import { Permission } from "../../src/permission"
import type * as Tool from "../../src/tool/tool"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Git } from "@/git"
import { Filesystem } from "@/util/filesystem"

const toolLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
  )

const it = testEffect(toolLayer())
const rooted = testEffect(Layer.mergeAll(toolLayer(), testInstanceStoreLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../..")
const full = (p: string) => (process.platform === "win32" ? Filesystem.normalizePath(p) : p)

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

const git = Effect.fn("GrepToolTest.git")(function* (cwd: string, args: string[]) {
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
    if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
    return stdout.trim()
  })
})

describe("tool.grep", () => {
  it.instance("fails for a missing relative directory instead of searching its parent", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "sibling.txt"), "sibling-marker"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const input = { pattern: "sibling-marker", path: "missing-dir" }
      const result = yield* grep.execute(input, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain("missing-dir")
        expect(Cause.pretty(result.cause)).toContain("not found")
        expect(Cause.pretty(result.cause)).not.toContain("sibling.txt")
      }
    }),
  )

  for (const target of ["missing-file.txt", "missing/deeper/target.txt"]) {
    it.instance(`fails for missing ${target} and includes the requested path`, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "sibling.txt"), "sibling-marker"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute({ pattern: "sibling-marker", path: target }, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(Cause.pretty(result.cause)).toContain(`Search path not found: ${target}`)
          expect(Cause.pretty(result.cause)).not.toContain("sibling.txt")
        }
      }),
    )
  }

  it.instance("searches the default instance directory with include filtering", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "match.ts"), "needle"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "sibling.txt"), "needle"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute({ pattern: "needle", include: "*.ts" }, ctx)
      expect(result.metadata).toEqual({ matches: 1, truncated: false })
      expect(result.output).toContain(path.join(test.directory, "match.ts"))
      expect(result.output).not.toContain("sibling.txt")
    }),
  )

  it.instance("denies grep before inspecting a missing path or searching siblings", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "sibling.txt"), "sibling-marker"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep
        .execute(
          { pattern: "sibling-marker", path: "missing-dir" },
          { ...ctx, ask: () => Effect.die(new Error("grep permission denied")) },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain("grep permission denied")
        expect(Cause.pretty(result.cause)).not.toContain("Search path not found")
        expect(Cause.pretty(result.cause)).not.toContain("sibling.txt")
      }
    }),
  )

  for (const failure of ["PermissionDenied", "interrupt", "defect", "resolved-NotFound"] as const) {
    it.instance(`preserves a target stat ${failure} instead of searching its parent`, () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const target = path.join(test.directory, "target.txt")
        yield* Effect.promise(() => Bun.write(target, "target-marker"))
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "sibling.txt"), "sibling-marker"))
        const fs = yield* FSUtil.Service
        const calls: string[] = []
        // Inject only the target stat boundary to prove errors and a disappearance between the two stats.
        const info = yield* GrepTool.pipe(
          Effect.provideService(
            FSUtil.Service,
            FSUtil.Service.of({
              ...fs,
              stat: (file) => {
                if (file !== target) return fs.stat(file)
                calls.push(file)
                if (failure === "resolved-NotFound" && calls.length === 1) return fs.stat(file)
                if (failure === "interrupt") return Effect.interrupt
                if (failure === "defect") return Effect.die(new Error("stat defect"))
                return Effect.fail(
                  PlatformError.systemError({
                    _tag: failure === "resolved-NotFound" ? "NotFound" : "PermissionDenied",
                    module: "FileSystem",
                    method: "stat",
                    pathOrDescriptor: file,
                  }),
                )
              },
            }),
          ),
        )
        const grep = yield* info.init()
        const result = yield* grep.execute({ pattern: "sibling-marker", path: "target.txt" }, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(calls).toHaveLength(failure === "resolved-NotFound" ? 2 : 1)
        if (Exit.isFailure(result)) {
          if (failure === "interrupt") {
            expect(Cause.hasInterruptsOnly(result.cause)).toBe(true)
            return
          }
          expect(Cause.hasDies(result.cause)).toBe(true)
          expect(Cause.pretty(result.cause)).toContain(
            failure === "resolved-NotFound"
              ? "Search path not found: target.txt"
              : failure === "defect"
                ? "stat defect"
                : "PermissionDenied",
          )
          expect(Cause.pretty(result.cause)).not.toContain("sibling.txt")
        }
      }),
    )
  }

  rooted.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.instance("no matches returns correct output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "hello world"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "xyznonexistentpatternxyz123",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No files found")
    }),
  )

  it.instance("finds matches in tmp instance", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
    }),
  )

  it.instance("does not report an unknown total when results are truncated", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 101 }, (_, index) =>
            Bun.write(path.join(test.directory, `match-${index}.txt`), "needle"),
          ),
        ),
      )
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute({ pattern: "needle", path: test.directory, include: "*.txt" }, ctx)

      expect(result.output).toContain("(Results truncated. Consider using a more specific path or pattern.)")
      expect(result.output).not.toMatch(/showing \d+ of \d+ matches/)
    }),
  )

  it.instance("supports exact file paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "test.txt")
      yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line2",
          path: file,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(file)
      expect(result.output).toContain("Line 2: line2")
    }),
  )

  it.instance("does not ask for external_directory when alias path is allowed", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return

      yield* TestInstance
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-grep-alias-"))),
        (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
      )
      const real = path.join(tmp, "real")
      const alias = path.join(tmp, "alias")
      yield* Effect.promise(() => fs.mkdir(real))
      yield* Effect.promise(() => fs.symlink(real, alias, "dir"))
      yield* Effect.promise(() => Bun.write(path.join(real, "test.txt"), "needle"))

      const ruleset = Permission.fromConfig({
        grep: "allow",
        external_directory: {
          [path.join(alias, "*")]: "allow",
        },
      })
      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const next: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            const needsAsk = req.patterns.some(
              (pattern) => Permission.evaluate(req.permission, pattern, ruleset).action !== "allow",
            )
            if (needsAsk) requests.push(req)
          }),
      }

      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: alias,
          include: "*.txt",
        },
        next,
      )

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(path.join(alias, "test.txt"))
      expect(result.output).not.toContain(path.join(real, "test.txt"))
      expect(requests.find((req) => req.permission === "external_directory")).toBeUndefined()
    }),
  )
})
