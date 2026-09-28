import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Fiber, Layer, Schema } from "effect"
import { AppConfig, type HookEntry, type HookInput, Hooks } from "../../src/contract"
import { layer, matches } from "../../src/hooks/hooks"
import { tmpdir } from "../lib/tmp"
import { config } from "../tools/harness"

function run(
  cwd: string,
  hook: "PreToolUse" | "PostToolUse" | "Stop",
  entries: HookEntry[],
  input: Partial<HookInput> = {},
) {
  const cfg = config(cwd, { hooks: { PreToolUse: [], PostToolUse: [], Stop: [], [hook]: entries } })
  return Effect.runPromise(
    Effect.gen(function* () {
      const hooks = yield* Hooks
      return yield* hooks.run(hook, {
        session_id: "ses_h",
        cwd,
        tool_name: "bash",
        tool_input: { command: "ls" },
        ...input,
      })
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg))))),
  )
}

const entry = (command: string, matcher = "*", timeout_ms = 10_000): HookEntry => ({ matcher, command, timeout_ms })

describe("hooks", () => {
  test("exit 0 continues, exit 2 blocks with stderr, other exits warn", async () => {
    await using dir = await tmpdir()
    expect(await run(dir.path, "PreToolUse", [entry("exit 0")])).toEqual({ kind: "continue" })
    expect(await run(dir.path, "PreToolUse", [entry("echo nope >&2; exit 2")])).toEqual({
      kind: "block",
      message: "nope",
    })
    expect(await run(dir.path, "PreToolUse", [entry("echo odd >&2; exit 1")])).toEqual({
      kind: "warn",
      message: 'hook "echo odd >&2; exit 1" exited with code 1: odd',
    })
    // The first block wins; later hooks don't run.
    const marker = path.join(dir.path, "later")
    expect((await run(dir.path, "PreToolUse", [entry("exit 2"), entry(`touch ${marker}`)])).kind).toBe("block")
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test("stdin carries the Claude-compatible JSON payload", async () => {
    await using dir = await tmpdir()
    const out = path.join(dir.path, "stdin.json")
    await run(dir.path, "PostToolUse", [entry(`cat > ${out}`)], { tool_output: "file list" })
    expect(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(await Bun.file(out).text())).toEqual({
      hook: "PostToolUse",
      hook_event_name: "PostToolUse",
      session_id: "ses_h",
      tool_name: "bash",
      tool_input: { command: "ls" },
      tool_output: "file list",
      cwd: dir.path,
    })
  })

  test("a hook past its timeout is killed (with its children) and reported as a warning", async () => {
    await using dir = await tmpdir()
    const pid = path.join(dir.path, "pid")
    const started = Date.now()
    const outcome = await run(dir.path, "PreToolUse", [entry(`sleep 30 & echo $! > ${pid}; wait`, "*", 300)])
    expect(outcome).toEqual({ kind: "warn", message: `hook "sleep 30 & echo $! > ${pid}; wait" timed out after 0.3 s` })
    expect(Date.now() - started).toBeLessThan(5000)
    await Bun.sleep(100)
    const child = Number((await Bun.file(pid).text()).trim())
    expect(() => process.kill(child, 0)).toThrow()
  })

  test("cancel interrupts a running hook at once and kills its group", async () => {
    await using dir = await tmpdir()
    const pid = path.join(dir.path, "pid")
    const cfg = config(dir.path, {
      hooks: { PreToolUse: [entry(`sleep 30 & echo $! > ${pid}; wait`)], PostToolUse: [], Stop: [] },
    })
    const started = Date.now()
    await Effect.runPromise(
      Effect.gen(function* () {
        const hooks = yield* Hooks
        const fiber = yield* Effect.forkChild(
          hooks.run("PreToolUse", { session_id: "ses_h", cwd: dir.path, tool_name: "bash" }),
        )
        yield* Effect.sleep(300)
        yield* Fiber.interrupt(fiber)
      }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg))))),
    )
    expect(Date.now() - started).toBeLessThan(3000)
    await Bun.sleep(100)
    const child = Number((await Bun.file(pid).text()).trim())
    expect(() => process.kill(child, 0)).toThrow()
  })

  test("completion is the hook's exit, even if a background child keeps stderr open", async () => {
    await using dir = await tmpdir()
    const started = Date.now()
    const outcome = await run(dir.path, "PreToolUse", [entry("(sleep 3 >&2 &); echo stop >&2; exit 2", "*", 2000)])
    expect(outcome).toEqual({ kind: "block", message: "stop" })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test("hooks inherit the parent environment and run in the session cwd", async () => {
    await using dir = await tmpdir()
    const out = path.join(dir.path, "env")
    await run(dir.path, "Stop", [entry(`printf '%s|%s' "$HOME" "$PWD" > ${out}`)], { tool_name: undefined })
    expect(await Bun.file(out).text()).toBe(`${process.env.HOME}|${dir.path}`)
  })

  test("matcher: case-insensitive, |-alternated globs against the oclite tool name", () => {
    expect(matches("Bash", "bash")).toBe(true)
    expect(matches("Edit|Write", "write")).toBe(true)
    expect(matches("Edit|Write", "read")).toBe(false)
    expect(matches("mcp__github__*", "mcp__github__create_issue")).toBe(true)
    expect(matches("*", "anything")).toBe(true)
    expect(matches("Read", undefined)).toBe(true)
  })
})
