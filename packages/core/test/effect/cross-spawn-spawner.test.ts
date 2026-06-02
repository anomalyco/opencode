import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Stream } from "effect"
import type * as PlatformError from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const live = CrossSpawnSpawner.defaultLayer
const fx = testEffect(live)

function js(code: string, opts?: ChildProcess.CommandOptions) {
  return ChildProcess.make("node", ["-e", code], opts)
}

function decodeByteStream(stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) {
  return Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const total = chunks.reduce((acc, x) => acc + x.length, 0)
      const out = new Uint8Array(total)
      let off = 0
      for (const chunk of chunks) {
        out.set(chunk, off)
        off += chunk.length
      }
      return new TextDecoder("utf-8").decode(out).trim()
    }),
  )
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-test-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function gone(pid: number, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !alive(pid)
}

async function readPid(file: string, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await fs.readFile(file, "utf-8").catch(() => undefined)
    if (value) return Number(value)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Process did not write its pid to ${file}`)
}

function stubbornDescendant(pidFile: string, parent: string, opts?: ChildProcess.CommandOptions) {
  const code = [
    'const cp = require("node:child_process")',
    'const fs = require("node:fs")',
    'cp.spawn(process.execPath, ["-e", "const fs = require(\\"node:fs\\"); process.on(\\"SIGTERM\\", () => {}); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", process.argv[1]], { stdio: "inherit" })',
    parent,
  ].join("\n")
  return ChildProcess.make(process.execPath, ["-e", code, pidFile], opts)
}

describe("cross-spawn spawner", () => {
  describe("basic spawning", () => {
    fx.effect(
      "captures stdout",
      Effect.gen(function* () {
        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("ok")'])),
        )
        expect(out).toBe("ok")
      }),
    )

    fx.effect(
      "captures multiple lines",
      Effect.gen(function* () {
        const handle = yield* js('console.log("line1"); console.log("line2"); console.log("line3")')
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("line1\nline2\nline3")
      }),
    )

    fx.effect(
      "returns exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(0)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )

    fx.effect(
      "returns non-zero exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(42)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(42))
      }),
    )
  })

  describe("cwd option", () => {
    fx.effect(
      "uses cwd when spawning commands",
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: tmp.path }),
          ),
        )
        expect(yield* Effect.promise(() => fs.realpath(out))).toBe(yield* Effect.promise(() => fs.realpath(tmp.path)))
      }),
    )

    fx.effect(
      "fails for invalid cwd",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
            svc.spawn(ChildProcess.make("echo", ["test"], { cwd: "/nonexistent/directory/path" })),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  describe("env option", () => {
    fx.effect(
      "passes environment variables with extendEnv",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write(process.env.TEST_VAR ?? "")', {
          env: { TEST_VAR: "test_value" },
          extendEnv: true,
        })
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("test_value")
      }),
    )

    fx.effect(
      "passes multiple environment variables",
      Effect.gen(function* () {
        const handle = yield* js(
          "process.stdout.write(`${process.env.VAR1}-${process.env.VAR2}-${process.env.VAR3}`)",
          {
            env: { VAR1: "one", VAR2: "two", VAR3: "three" },
            extendEnv: true,
          },
        )
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("one-two-three")
      }),
    )
  })

  describe("stderr", () => {
    fx.effect(
      "captures stderr output",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("error message")')
        const err = yield* decodeByteStream(handle.stderr)
        expect(err).toBe("error message")
      }),
    )

    fx.effect(
      "captures both stdout and stderr",
      Effect.gen(function* () {
        const handle = yield* js(
          [
            "let pending = 2",
            "const done = () => {",
            "  pending -= 1",
            "  if (pending === 0) setTimeout(() => process.exit(0), 0)",
            "}",
            'process.stdout.write("stdout\\n", done)',
            'process.stderr.write("stderr\\n", done)',
          ].join("\n"),
        )
        const [stdout, stderr] = yield* Effect.all([decodeByteStream(handle.stdout), decodeByteStream(handle.stderr)], {
          concurrency: 2,
        })
        expect(stdout).toBe("stdout")
        expect(stderr).toBe("stderr")
      }),
    )
  })

  describe("combined output (all)", () => {
    fx.effect(
      "captures stdout via .all when no stderr",
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("hello from stdout")'])
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stdout")
      }),
    )

    fx.effect(
      "captures stderr via .all when no stdout",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("hello from stderr")')
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stderr")
      }),
    )
  })

  describe("stdin", () => {
    fx.effect(
      "allows providing standard input to a command",
      Effect.gen(function* () {
        const input = "a b c"
        const stdin = Stream.make(Buffer.from(input, "utf-8"))
        const handle = yield* js(
          'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
          { stdin },
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("a b c")
      }),
    )
  })

  describe("process control", () => {
    fx.effect(
      "kills a running process",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* js("setTimeout(() => {}, 10_000)")
            yield* handle.kill()
            return yield* handle.exitCode
          }),
        )
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )

    fx.effect(
      "kills a child when scope exits",
      Effect.gen(function* () {
        const pid = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* js("setInterval(() => {}, 10_000)")
            return Number(handle.pid)
          }),
        )
        const done = yield* Effect.promise(() => gone(pid))
        expect(done).toBe(true)
      }),
    )

    fx.effect(
      "forceKillAfter escalates for stubborn processes",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const started = Date.now()
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* js('process.on("SIGTERM", () => {}); setInterval(() => {}, 10_000)')
            yield* handle.kill({ forceKillAfter: 100 })
            return yield* handle.exitCode
          }),
        )

        expect(Date.now() - started).toBeLessThan(1_000)
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )

    fx.live(
      "forceKillAfter escalates when the parent exits before a stubborn descendant",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const pidFile = path.join(tmp.path, "stubborn-child.pid")
        const handle = yield* stubbornDescendant(pidFile, "setInterval(() => {}, 1000)")
        const pid = yield* Effect.promise(() => readPid(pidFile))

        yield* handle.kill({ forceKillAfter: 100 }).pipe(Effect.ignore)
        const terminated = yield* Effect.promise(() => gone(pid, 1_000))
        if (!terminated) {
          yield* Effect.sync(() => process.kill(pid, "SIGKILL"))
        }
        expect(terminated).toBe(true)
      }),
      10_000,
    )

    fx.live(
      "scope cleanup escalates after a failed parent leaves a stubborn descendant",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const pidFile = path.join(tmp.path, "failed-parent-child.pid")
        const pid = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* stubbornDescendant(
              pidFile,
              "const ready = setInterval(() => { if (fs.existsSync(process.argv[1])) { clearInterval(ready); process.exit(42) } }, 10)",
              { forceKillAfter: 100 },
            )
            expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(42))
            return yield* Effect.promise(() => readPid(pidFile))
          }),
        )

        const terminated = yield* Effect.promise(() => gone(pid, 1_000))
        if (!terminated) {
          yield* Effect.sync(() => process.kill(pid, "SIGKILL"))
        }
        expect(terminated).toBe(true)
      }),
      10_000,
    )

    fx.live(
      "scope cleanup does not hang when a failed parent leaves a descendant holding stdio",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const pidFile = path.join(tmp.path, "failed-parent-no-force.pid")

        // No forceKillAfter, matching how the shell tool spawns. The descendant
        // ignores SIGTERM and keeps the inherited stdio open, so the parent's
        // "close" never fires. Closing the scope must not block on it; the test
        // timeout below is the regression guard against an unbounded teardown.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* stubbornDescendant(
              pidFile,
              "const ready = setInterval(() => { if (fs.existsSync(process.argv[1])) { clearInterval(ready); process.exit(7) } }, 10)",
            )
            expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(7))
          }),
        )

        // Reap the descendant so it does not leak across the test run.
        const pid = yield* Effect.promise(() => readPid(pidFile).catch(() => 0))
        if (pid) {
          yield* Effect.sync(() => {
            try {
              process.kill(pid, "SIGKILL")
            } catch {}
          })
        }
      }),
      10_000,
    )

    fx.live(
      "kill escalation does not hang when a stubborn descendant escapes the process group",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const pidFile = path.join(tmp.path, "escaped-descendant.pid")

        // The parent stays alive and spawns a detached (own session) child that
        // inherits stdio. SIGKILL to the parent's group never reaches the escaped
        // child, so the parent's "close" never fires. kill() must escalate to
        // SIGKILL and still return instead of waiting on "close" forever.
        const code = [
          'const cp = require("node:child_process")',
          'const fs = require("node:fs")',
          'const child = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "inherit" })',
          "child.unref()",
          "fs.writeFileSync(process.argv[1], String(child.pid))",
          'process.on("SIGTERM", () => {})',
          "setInterval(() => {}, 1000)",
        ].join("\n")

        const outcome = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make(process.execPath, ["-e", code, pidFile])
            yield* Effect.promise(() => readPid(pidFile))
            return yield* handle
              .kill({ forceKillAfter: 100 })
              .pipe(
                Effect.as("returned" as const),
                Effect.timeoutOrElse({ duration: "4 seconds", orElse: () => Effect.succeed("hung" as const) }),
              )
          }),
        )

        // Reap the escaped descendant so it does not leak across the test run.
        const pid = yield* Effect.promise(() => readPid(pidFile).catch(() => 0))
        if (pid) {
          yield* Effect.sync(() => {
            try {
              process.kill(pid, "SIGKILL")
            } catch {}
          })
        }

        expect(outcome).toBe("returned")
      }),
      15_000,
    )

    fx.effect(
      "isRunning reflects process state",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("done")')
        yield* handle.exitCode
        const running = yield* handle.isRunning
        expect(running).toBe(false)
      }),
    )
  })

  describe("detached children (issue #24731)", () => {
    fx.live(
      "exitCode resolves when the main process exits even if a detached child keeps stdio open",
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const pidFile = path.join(tmp.path, "daemon.pid")

        // Mimics playwright-cli / a backgrounded web server: spawn a long-lived
        // detached child that inherits stdio (keeping the parent's stdout pipe's
        // write end open), then exit the main process immediately.
        const code = [
          'const cp = require("node:child_process")',
          'const fs = require("node:fs")',
          'const daemon = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "inherit" })',
          "daemon.unref()",
          "fs.writeFileSync(process.argv[1], String(daemon.pid))",
          'process.stdout.write("started")',
          "process.exit(0)",
        ].join("\n")

        const handle = yield* ChildProcess.make(process.execPath, ["-e", code, pidFile])

        const result = yield* Effect.raceAll([
          handle.exitCode.pipe(Effect.map((exit) => ({ kind: "exit" as const, code: exit }))),
          Effect.sleep("5 seconds").pipe(Effect.as({ kind: "timeout" as const, code: null })),
        ])

        // Reap the detached daemon so it does not leak and so the spawner's
        // "close" can fire during scope teardown.
        const pid = Number(yield* Effect.promise(() => fs.readFile(pidFile, "utf-8").catch(() => "0")))
        if (pid) {
          yield* Effect.sync(() => {
            try {
              process.kill(pid)
            } catch {}
          })
        }

        expect(result.kind).toBe("exit")
        expect(result.code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
      15_000,
    )
  })

  describe("error handling", () => {
    fx.effect(
      "fails for invalid command",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make("nonexistent-command-12345")
            return yield* handle.exitCode
          }),
        )
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )
  })

  describe("pipeline", () => {
    fx.effect(
      "pipes stdout of one command to stdin of another",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello world")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.toUpperCase()))',
            ),
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("HELLO WORLD")
      }),
    )

    fx.effect(
      "three-stage pipeline",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello world")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.toUpperCase()))',
            ),
          ),
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.replaceAll(" ", "-")))',
            ),
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("HELLO-WORLD")
      }),
    )

    fx.effect(
      "pipes stderr with { from: 'stderr' }",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("error")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
            ),
            { from: "stderr" },
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("error")
      }),
    )

    fx.effect(
      "pipes combined output with { from: 'all' }",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
            ),
            { from: "all" },
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toContain("stdout")
        expect(out).toContain("stderr")
      }),
    )
  })

  describe("Windows-specific", () => {
    fx.effect(
      "uses shell routing on Windows",
      Effect.gen(function* () {
        if (process.platform !== "win32") return

        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make("set", ["OPENCODE_TEST_SHELL"], {
              shell: true,
              extendEnv: true,
              env: { OPENCODE_TEST_SHELL: "ok" },
            }),
          ),
        )
        expect(out).toContain("OPENCODE_TEST_SHELL=ok")
      }),
    )

    fx.effect(
      "runs cmd scripts with spaces on Windows without shell",
      Effect.gen(function* () {
        if (process.platform !== "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const dir = path.join(tmp.path, "with space")
        const file = path.join(dir, "echo cmd.cmd")

        yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n"))

        const code = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.exitCode(
            ChildProcess.make(file, ["--stdio"], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            }),
          ),
        )
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )
  })
})
