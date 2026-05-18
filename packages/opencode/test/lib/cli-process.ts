// Subprocess test harness for the opencode CLI. Spawns the real binary against
// a TestLLMServer running in-process at a random port, with full env isolation.
//
// This is the missing test tier: in-process tests can't catch bugs that span
// argv parsing → server boot → SDK call → event consumption → exit code (like
// the original /event race or #27371's invalid-model hang).
//
// Configuration flows through opencode's built-in test affordances:
//   - OPENCODE_CONFIG_CONTENT      : provider config inline, no files to find
//   - OPENCODE_TEST_HOME           : pins os.homedir() → tmpdir
//   - OPENCODE_DISABLE_PROJECT_CONFIG : skip walking up for opencode.json
//   - OPENCODE_PURE                : skip external plugin discovery + install
//   - OPENCODE_DISABLE_AUTOUPDATE / AUTOCOMPACT / MODELS_FETCH : no background work
// Plus HOME / XDG_* pointing at the tmpdir for belt-and-suspenders isolation.
//
// Today only `opencode.run` is fully wired. The shape supports adding more
// builders (`opencode.serve(opts)`, `opencode.acp(opts)`, `opencode.auth(...)`)
// without changing the fixture. Long-lived commands like `serve` will need a
// different return shape — see the TODO at the bottom of OpencodeCli.
import type { TestOptions } from "bun:test"
import * as Scope from "effect/Scope"
import { Effect } from "effect"
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { Process } from "@/util/process"
import { TestLLMServer } from "./llm-server"
import { testProviderConfig } from "./test-provider"
import { it } from "./effect"

const opencodeRoot = path.resolve(import.meta.dir, "../../")
const cliEntry = path.join(opencodeRoot, "src/index.ts")

export const testModelID = "test/test-model"

function isolatedEnv(home: string, configJson: string): Record<string, string> {
  return {
    OPENCODE_TEST_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_CONFIG_CONTENT: configJson,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }
}

export type RunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export type SpawnOpts = { readonly timeoutMs?: number; readonly env?: Record<string, string> }

// Typed equivalent of constructing argv for `opencode run`. New flags should
// land here so tests stay grep-able and refactor-safe.
export type RunOpts = SpawnOpts & {
  readonly model?: string
  readonly agent?: string
  readonly format?: "default" | "json"
  readonly command?: string
  readonly printLogs?: boolean
  readonly extraArgs?: string[]
}

export type OpencodeCli = {
  // High-level: run a single prompt against the test model. Short-lived.
  readonly run: (message: string, opts?: RunOpts) => Effect.Effect<RunResult>
  // Escape hatch: any CLI invocation with full control over argv. Used to test
  // commands that don't yet have a typed builder.
  readonly spawn: (args: string[], opts?: SpawnOpts) => Effect.Effect<RunResult>
  // Convenience assertion. Dumps captured stderr/stdout on mismatch so CI
  // failures are debuggable without re-running locally.
  readonly expectExit: (result: RunResult, expected: number, label?: string) => void
  // Parse `--format json` stdout into one event object per non-empty line.
  // The CLI writes `JSON.stringify({ type, sessionID, ... }) + EOL` for each
  // event (see src/cli/cmd/run.ts `emit`). Throws on a malformed line so
  // tests fail loudly rather than silently skipping data.
  readonly parseJsonEvents: (stdout: string) => Array<Record<string, unknown>>
  // TODO: long-lived builders for `serve` / `acp` / etc. need a different
  // return shape — they yield a handle with .url / .kill and live inside the
  // surrounding Scope. Add when the first long-lived command is tested.
}

export type CliFixture = {
  readonly llm: TestLLMServer["Service"]
  readonly home: string
  readonly opencode: OpencodeCli
}

// Provisions a TestLLMServer + tmpdir + spawn helper and invokes fn. Cleans
// up the tmpdir on scope exit. TestLLMServer.layer is provided internally so
// the caller doesn't need to wire it up — the fixture's lifetime is tied to
// the surrounding Scope.
export function withCliFixture<A, E>(
  fn: (input: CliFixture) => Effect.Effect<A, E>,
): Effect.Effect<A, E | unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer

    const home = path.join(os.tmpdir(), "oc-cli-" + Math.random().toString(36).slice(2))
    yield* Effect.promise(() => fs.mkdir(home, { recursive: true }))
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => fs.rm(home, { recursive: true, force: true }).catch(() => undefined)),
    )

    const configJson = JSON.stringify(testProviderConfig(llm.url))
    const env = isolatedEnv(home, configJson)

    const spawn = (args: string[], opts?: SpawnOpts): Effect.Effect<RunResult> =>
      Effect.promise(async () => {
        const start = Date.now()
        // Process.run pipes stdout/stderr by default and returns them as Buffers.
        const result = await Process.run(["bun", "run", "--conditions=browser", cliEntry, ...args], {
          cwd: home,
          timeout: opts?.timeoutMs ?? 30_000,
          env: { ...process.env, ...env, ...opts?.env },
          nothrow: true,
        })
        return {
          exitCode: result.code,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
          durationMs: Date.now() - start,
        }
      })

    const run = (message: string, opts?: RunOpts): Effect.Effect<RunResult> => {
      const argv: string[] = ["run"]
      if (opts?.printLogs) argv.push("--print-logs")
      argv.push("--model", opts?.model ?? testModelID)
      if (opts?.agent) argv.push("--agent", opts.agent)
      if (opts?.format) argv.push("--format", opts.format)
      if (opts?.command) argv.push("--command", opts.command)
      if (opts?.extraArgs) argv.push(...opts.extraArgs)
      argv.push(message)
      return spawn(argv, opts)
    }

    const opencode: OpencodeCli = { run, spawn, expectExit, parseJsonEvents }

    return yield* fn({ llm, home, opencode })
  }).pipe(Effect.provide(TestLLMServer.layer))
}

function parseJsonEvents(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

// Convenience for the common assertion pattern. Dumps stderr/stdout when
// the exit code doesn't match — saves debugging time on CI failures.
function expectExit(result: RunResult, expected: number, label = "opencode") {
  if (result.exitCode === expected) return
  const tail = (s: string, n: number) => (s.length > n ? "..." + s.slice(-n) : s)
  // eslint-disable-next-line no-console
  console.error(`[${label}] expected exit ${expected}, got ${result.exitCode} after ${result.durationMs}ms`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stderr (last 2000):\n${tail(result.stderr, 2000)}`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stdout (last 500):\n${tail(result.stdout, 500)}`)
  throw new Error(`${label}: expected exit ${expected}, got ${result.exitCode}`)
}

// `cliIt.live(name, fixture => effect)` is the same as
// `it.live(name, () => withCliFixture(fixture))` — one fewer nesting level at
// every call site. Use this for any test that needs the opencode CLI fixture.
//
// Only `.live` is exposed because subprocess tests must run against the real
// clock — a TestClock-paused environment can't drive a child process. If you
// need `.only` or `.skip`, fall back to `it.live` + `withCliFixture` directly.
export const cliIt = {
  live: <A, E>(name: string, body: (input: CliFixture) => Effect.Effect<A, E>, opts?: number | TestOptions) =>
    it.live(name, () => withCliFixture(body), opts),
}
