import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigClaudeHooksPlugin } from "@opencode/core/config/plugin/claude-hooks"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, AppProcess.node])))
// The hook commands below are POSIX shell.
const live = process.platform === "win32" ? it.live.skip : it.live

type Before = ToolHooks["execute.before"]
type After = ToolHooks["execute.after"]

const base = {
  tool: "shell",
  sessionID: "ses_test",
  agent: "build",
  messageID: "msg_test",
  id: "call_test",
  input: { command: "git push" },
}

/** Starts the plugin against settings written to a temporary .claude directory and returns its two hooks. */
const start = Effect.fnUntraced(function* (directory: string, settings: unknown, local?: unknown, project?: unknown) {
  const claude = path.join(directory, ".claude")
  const repo = path.join(directory, "repo", ".claude")
  yield* Effect.promise(async () => {
    await fs.mkdir(claude, { recursive: true })
    await fs.writeFile(path.join(claude, "settings.json"), JSON.stringify(settings))
    if (local) await fs.writeFile(path.join(claude, "settings.local.json"), JSON.stringify(local))
    await fs.mkdir(repo, { recursive: true })
    if (project) await fs.writeFile(path.join(repo, "settings.json"), JSON.stringify(project))
  })
  const hooks: {
    before?: (event: Before) => Effect.Effect<void, unknown>
    after?: (event: After) => Effect.Effect<void>
  } = {}
  yield* ConfigClaudeHooksPlugin.Plugin.effect(
    host({
      tool: {
        transform: () => Effect.die("unused tool.transform"),
        reload: () => Effect.die("unused tool.reload"),
        list: () => Effect.die("unused tool.list"),
        hook: (name, callback) => {
          // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "execute.before") hooks.before = callback as unknown as typeof hooks.before
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "execute.after") hooks.after = callback as unknown as typeof hooks.after
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provide(Config.testLayer([], { claude: [AbsolutePath.make(claude), AbsolutePath.make(repo)], agents: [] })),
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: directory })),
    Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { before: (event: unknown) => hooks.before!(event as Before), after: (event: After) => hooks.after!(event) }
})

const command = (matcher: string, command: string) => ({ matcher, hooks: [{ type: "command", command }] })

describe("ConfigClaudeHooksPlugin", () => {
  test("parses command hooks and skips everything else", () => {
    expect(
      ConfigClaudeHooksPlugin.parse(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  { type: "command", command: "a", timeout: 5 },
                  { type: "prompt", prompt: "b" },
                ],
              },
              { hooks: [{ type: "command", command: "c" }] },
              "invalid",
            ],
            Stop: [{ hooks: [{ type: "command", command: "d" }] }],
          },
        }),
      ),
    ).toEqual({
      PreToolUse: [
        { matcher: "Bash", command: "a", timeout: 5 },
        { matcher: "", command: "c", timeout: 60 },
      ],
      PostToolUse: [],
    })
    expect(ConfigClaudeHooksPlugin.parse("not json")).toEqual({ PreToolUse: [], PostToolUse: [] })
  })

  test("matches tool names like Claude Code", () => {
    expect(ConfigClaudeHooksPlugin.matches("", "Bash")).toBe(true)
    expect(ConfigClaudeHooksPlugin.matches("*", "Bash")).toBe(true)
    expect(ConfigClaudeHooksPlugin.matches("Edit|Write", "Write")).toBe(true)
    expect(ConfigClaudeHooksPlugin.matches("Edit", "MultiEdit")).toBe(false)
    expect(ConfigClaudeHooksPlugin.matches("mcp__.*", "mcp__github__search")).toBe(true)
    expect(ConfigClaudeHooksPlugin.matches("(", "Bash")).toBe(false)
  })

  test("adds Claude Code input names next to the native ones", () => {
    expect(ConfigClaudeHooksPlugin.toolInput({ path: "a.ts", oldString: "x", newString: "y" })).toEqual({
      path: "a.ts",
      oldString: "x",
      newString: "y",
      file_path: "a.ts",
      old_string: "x",
      new_string: "y",
    })
  })

  live("PreToolUse exit 2 blocks the call with stderr as the message", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const hooks = yield* start(tmp.path, {
            hooks: { PreToolUse: [command("Bash", "cat > payload.json; echo 'run the tests first' >&2; exit 2")] },
          })
          const exit = yield* hooks.before({ ...base }).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(String(exit)).toContain("run the tests first")
          expect(
            JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "payload.json"), "utf8"))),
          ).toEqual({
            session_id: "ses_test",
            cwd: tmp.path,
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "git push" },
            tool_use_id: "call_test",
          })
        }),
      ),
    ),
  )

  live("PreToolUse allows the call when no hook matches or the hook exits 0 or 1", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const hooks = yield* start(
            tmp.path,
            { hooks: { PreToolUse: [command("Edit|Write", "exit 2"), command("Bash", "exit 1")] } },
            { hooks: { PreToolUse: [command("*", "touch ran-local")] } },
          )
          yield* hooks.before({ ...base })
          expect(yield* Effect.promise(() => fs.stat(path.join(tmp.path, "ran-local")))).toBeDefined()
          expect(Exit.isFailure(yield* hooks.before({ ...base, tool: "write" }).pipe(Effect.exit))).toBe(true)
        }),
      ),
    ),
  )

  live("ignores hooks from a project .claude directory", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const hooks = yield* start(tmp.path, {}, undefined, { hooks: { PreToolUse: [command("*", "exit 2")] } })
          yield* hooks.before({ ...base })
        }),
      ),
    ),
  )

  live("PostToolUse exit 2 appends stderr to the tool result", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const hooks = yield* start(tmp.path, {
            hooks: { PostToolUse: [command("Edit", "cat > payload.json; echo 'lint failed' >&2; exit 2")] },
          })
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          const event = {
            ...base,
            tool: "edit",
            input: { path: "a.ts", oldString: "x", newString: "y" },
            status: "completed",
            result: { content: "edited a.ts" },
          } as unknown as After & { status: "completed" }
          yield* hooks.after(event)
          expect(event.result.content).toEqual([
            { type: "text", text: "edited a.ts" },
            { type: "text", text: "lint failed" },
          ])
          const payload = JSON.parse(
            yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "payload.json"), "utf8")),
          )
          expect(payload.tool_name).toBe("Edit")
          expect(payload.tool_input.file_path).toBe("a.ts")
          expect(payload.tool_response).toBe("edited a.ts")
        }),
      ),
    ),
  )
})
