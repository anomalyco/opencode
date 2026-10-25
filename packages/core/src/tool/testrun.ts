import { Effect, Schema, Stream } from "effect"
import path from "path"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { Shell } from "@bolt-ai/core/shell"
import { ShellID } from "./shell/id"
import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./testrun.txt"

const DEFAULT_TIMEOUT = 10 * 60 * 1000

export type Failure = {
  name: string
  file?: string
  message?: string
}

type Matcher = {
  pattern: RegExp
  failure: (match: RegExpExecArray) => Failure
}

// One matcher per test-runner output dialect. Each yields the failing test's name and,
// when the dialect carries it, the file and message.
const matchers: Matcher[] = [
  // pytest: FAILED tests/test_x.py::test_name - AssertionError: boom
  {
    pattern: /^FAILED (\S+?)::(\S+?)(?: - (.*))?$/gm,
    failure: (m) => ({ name: m[2], file: m[1], ...(m[3] ? { message: m[3] } : {}) }),
  },
  // go: --- FAIL: TestName (0.00s)
  { pattern: /^--- FAIL: (\S+)/gm, failure: (m) => ({ name: m[1] }) },
  // cargo: test module::case ... FAILED
  { pattern: /^test (\S+) \.\.\. FAILED$/gm, failure: (m) => ({ name: m[1] }) },
  // bun test: (fail) suite > case
  { pattern: /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm, failure: (m) => ({ name: m[1] }) },
  // jest/vitest/mocha glyphs: ✕ case, ✗ case, × case
  { pattern: /^\s*[✕✗×] (.+?)(?: \(\d+ ?m?s\))?$/gm, failure: (m) => ({ name: m[1] }) },
  // TAP: not ok 3 - case name
  { pattern: /^not ok \d+ (?:- )?(.+)$/gm, failure: (m) => ({ name: m[1] }) },
]

const counters = [
  // bun/vitest style: "3 pass" / "1 fail", pytest style: "1 failed, 3 passed"
  /(?<fail>\d+) fail(?:ed)?(?:,| |$)/m,
  /(?<pass>\d+) pass(?:ed)?(?:,| |$)/m,
]

/** Extract structured failures and pass/fail counts from raw test-runner output. */
export function parse(text: string) {
  const seen = new Set<string>()
  const failures: Failure[] = []
  for (const matcher of matchers) {
    matcher.pattern.lastIndex = 0
    for (const match of text.matchAll(matcher.pattern)) {
      const failure = matcher.failure(match as unknown as RegExpExecArray)
      const key = `${failure.file ?? ""}::${failure.name}`
      if (seen.has(key)) continue
      seen.add(key)
      failures.push(failure)
    }
  }
  const counts: { pass?: number; fail?: number } = {}
  for (const counter of counters) {
    const match = text.match(counter)
    if (!match?.groups) continue
    if (match.groups.fail !== undefined) counts.fail = Number(match.groups.fail)
    if (match.groups.pass !== undefined) counts.pass = Number(match.groups.pass)
  }
  return { failures, counts }
}

/** Detect the project's test command from lockfiles and manifests. */
export const detect = Effect.fn("TestRunTool.detect")(function* (fs: FSUtil.Interface, dir: string) {
  const manifest = path.join(dir, "package.json")
  if (yield* fs.existsSafe(manifest)) {
    const pkg = yield* Effect.tryPromise(() => Bun.file(manifest).json()).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (pkg?.scripts?.test) {
      if (yield* fs.existsSafe(path.join(dir, "bun.lock"))) return "bun run test"
      if (yield* fs.existsSafe(path.join(dir, "bun.lockb"))) return "bun run test"
      if (yield* fs.existsSafe(path.join(dir, "pnpm-lock.yaml"))) return "pnpm test"
      if (yield* fs.existsSafe(path.join(dir, "yarn.lock"))) return "yarn test"
      return "npm test"
    }
  }
  if (yield* fs.existsSafe(path.join(dir, "Cargo.toml"))) return "cargo test"
  if (yield* fs.existsSafe(path.join(dir, "go.mod"))) return "go test ./..."
  if (yield* fs.existsSafe(path.join(dir, "pytest.ini"))) return "pytest"
  if (yield* fs.existsSafe(path.join(dir, "pyproject.toml"))) return "pytest"
  return undefined
})

export const Parameters = Schema.Struct({
  command: Schema.optional(Schema.String).annotate({
    description:
      "Test command to run. When omitted, the project's test command is detected from package.json, Cargo.toml, go.mod, or pytest config.",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory to run tests in. Defaults to the project directory.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Optional timeout in milliseconds (default 600000)",
  }),
})

export const TestRunTool = Tool.define(
  "test_run",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const fs = yield* FSUtil.Service
    const trunc = yield* Truncate.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = params.workdir ? path.resolve(instance.directory, params.workdir) : instance.directory
          const command = params.command ?? (yield* detect(fs, cwd))
          if (!command) {
            throw new Error("Could not detect a test command for this project. Pass the command parameter explicitly.")
          }

          const tokens = command.trim().split(/\s+/)
          yield* ctx.ask({
            permission: ShellID.ToolID,
            patterns: [command],
            always: [BashArity.prefix(tokens).join(" ") + " *"],
            metadata: { command, test: true },
          })

          const cfg = yield* config.get()
          const shell = Shell.acceptable(cfg.shell)
          const extra = yield* plugin.trigger(
            "shell.env",
            { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
            { env: {} },
          )
          const env = { ...process.env, ...extra.env }
          const timeout = params.timeout ?? DEFAULT_TIMEOUT
          const limits = yield* trunc.limits()

          let raw = ""
          let expired = false
          const code = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                process.platform === "win32" && Shell.ps(shell)
                  ? ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
                      cwd,
                      env,
                      stdin: "ignore",
                      detached: false,
                    })
                  : ChildProcess.make(command, [], {
                      shell,
                      cwd,
                      env,
                      stdin: "ignore",
                      detached: process.platform !== "win32",
                    }),
              )
              yield* Effect.forkScoped(
                Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                  Effect.sync(() => {
                    raw += chunk
                    // Cap memory while keeping the tail, where summaries and failures live.
                    const keep = limits.maxBytes * 4
                    if (raw.length > keep) raw = raw.slice(raw.length - keep)
                  }),
                ),
              )
              const exit = yield* Effect.raceAll([
                handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
                Effect.sleep(`${timeout} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
              ])
              if (exit.kind === "timeout") {
                expired = true
                yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catch(() => Effect.void))
              }
              return exit.code
            }),
          ).pipe(Effect.orDie)

          const result = parse(raw)
          const passed = code === 0 && !expired
          const lines: string[] = []
          lines.push(`status=${expired ? "timeout" : passed ? "pass" : "fail"}`)
          lines.push(`command=${command}`)
          if (code !== null) lines.push(`exit=${code}`)
          if (result.counts.pass !== undefined || result.counts.fail !== undefined) {
            lines.push(`passed=${result.counts.pass ?? "?"} failed=${result.counts.fail ?? "?"}`)
          }
          if (!passed && result.failures.length > 0) {
            lines.push("", "Failures:")
            for (const failure of result.failures.slice(0, 50)) {
              const loc = failure.file ? ` (${failure.file})` : ""
              const msg = failure.message ? `: ${failure.message}` : ""
              lines.push(`- ${failure.name}${loc}${msg}`)
            }
            if (result.failures.length > 50) lines.push(`...and ${result.failures.length - 50} more`)
          }
          if (!passed) {
            const tail = raw.length > limits.maxBytes ? raw.slice(raw.length - limits.maxBytes) : raw
            lines.push("", "Output tail:", tail.trimEnd() || "(no output)")
          }

          return {
            title: `${command} [${expired ? "timeout" : passed ? "pass" : "fail"}]`,
            output: lines.join("\n"),
            metadata: {
              command,
              exit: code,
              passed,
              failureCount: result.failures.length,
              ...(result.counts.pass !== undefined ? { passCount: result.counts.pass } : {}),
              ...(result.counts.fail !== undefined ? { failCount: result.counts.fail } : {}),
            },
          }
        }),
    }
  }),
)
