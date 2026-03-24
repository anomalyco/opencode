import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Exit, Layer, Stream } from "effect"
import type * as PlatformError from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { tmpdir } from "../fixture/fixture"

const live = CrossSpawnSpawner.layer.pipe(Layer.provide(NodeFileSystem.layer), Layer.provide(NodePath.layer))

function js(code: string, opts?: ChildProcess.CommandOptions) {
  return ChildProcess.make("node", ["-e", code], opts)
}

function run<A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) {
  return Effect.runPromise(effect.pipe(Effect.provide(live)))
}

function runScoped<A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | import("effect/Scope").Scope>,
) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(live)))
}

function decodeByteStream(stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) {
  return Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return new TextDecoder("utf-8").decode(result).trim()
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

async function gone(pid: number, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await Bun.sleep(50)
  }
  return !alive(pid)
}

describe("cross-spawn spawner", () => {
  describe("basic spawning", () => {
    test("captures stdout", async () => {
      const out = await run(
        ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("ok")'])),
        ),
      )
      expect(out).toBe("ok")
    })

    test("captures multiple lines", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('console.log("line1"); console.log("line2"); console.log("line3")')
          return yield* decodeByteStream(handle.stdout)
        }),
      )
      expect(out).toBe("line1\nline2\nline3")
    })

    test("returns exit code", async () => {
      const code = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js("process.exit(0)")
          return yield* handle.exitCode
        }),
      )
      expect(code).toBe(ChildProcessSpawner.ExitCode(0))
    })

    test("returns non-zero exit code", async () => {
      const code = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js("process.exit(42)")
          return yield* handle.exitCode
        }),
      )
      expect(code).toBe(ChildProcessSpawner.ExitCode(42))
    })
  })

  describe("cwd option", () => {
    test("uses cwd when spawning commands", async () => {
      await using tmp = await tmpdir()

      const out = await run(
        ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: tmp.path }),
          ),
        ),
      )
      expect(out).toBe(tmp.path)
    })

    test("fails for invalid cwd", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(ChildProcess.make("echo", ["test"], { cwd: "/nonexistent/directory/path" }).asEffect()).pipe(
          Effect.provide(live),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  describe("env option", () => {
    test("passes environment variables with extendEnv", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write(process.env.TEST_VAR ?? "")', {
            env: { TEST_VAR: "test_value" },
            extendEnv: true,
          })
          return yield* decodeByteStream(handle.stdout)
        }),
      )
      expect(out).toBe("test_value")
    })

    test("passes multiple environment variables", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js(
            "process.stdout.write(`${process.env.VAR1}-${process.env.VAR2}-${process.env.VAR3}`)",
            {
              env: { VAR1: "one", VAR2: "two", VAR3: "three" },
              extendEnv: true,
            },
          )
          return yield* decodeByteStream(handle.stdout)
        }),
      )
      expect(out).toBe("one-two-three")
    })
  })

  describe("stderr", () => {
    test("captures stderr output", async () => {
      const err = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stderr.write("error message")')
          return yield* decodeByteStream(handle.stderr)
        }),
      )
      expect(err).toBe("error message")
    })

    test("captures both stdout and stderr", async () => {
      const { stdout, stderr } = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n")')
          const [stdout, stderr] = yield* Effect.all([decodeByteStream(handle.stdout), decodeByteStream(handle.stderr)])
          return { stdout, stderr }
        }),
      )
      expect(stdout).toBe("stdout")
      expect(stderr).toBe("stderr")
    })
  })

  describe("combined output (all)", () => {
    test("captures stdout via .all when no stderr", async () => {
      const all = await runScoped(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make("echo", ["hello from stdout"])
          return yield* decodeByteStream(handle.all)
        }),
      )
      expect(all).toBe("hello from stdout")
    })

    test("captures stderr via .all when no stdout", async () => {
      const all = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stderr.write("hello from stderr")')
          return yield* decodeByteStream(handle.all)
        }),
      )
      expect(all).toBe("hello from stderr")
    })
  })

  describe("stdin", () => {
    test("allows providing standard input to a command", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const input = "a b c"
          const stdin = Stream.make(Buffer.from(input, "utf-8"))
          const handle = yield* js(
            'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
            { stdin },
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("a b c")
    })
  })

  describe("process control", () => {
    test("kills a running process", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* js("setTimeout(() => {}, 10_000)")
            yield* handle.kill()
            return yield* handle.exitCode
          }),
        ).pipe(Effect.provide(live)),
      )
      expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
    })

    test("kills a child when scope exits", async () => {
      const pid = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* js("setInterval(() => {}, 10_000)")
            return Number(handle.pid)
          }),
        ).pipe(Effect.provide(live)),
      )

      expect(await gone(pid)).toBe(true)
    })

    test("forceKillAfter escalates for stubborn processes", async () => {
      if (process.platform === "win32") return

      const started = Date.now()
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* js('process.on("SIGTERM", () => {}); setInterval(() => {}, 10_000)')
            yield* handle.kill({ forceKillAfter: 100 })
            return yield* handle.exitCode
          }),
        ).pipe(Effect.provide(live)),
      )

      expect(Date.now() - started).toBeLessThan(1_000)
      expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
    })

    test("isRunning reflects process state", async () => {
      await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("done")')
          yield* handle.exitCode
          const running = yield* handle.isRunning
          expect(running).toBe(false)
        }),
      )
    })
  })

  describe("error handling", () => {
    test("fails for invalid command", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make("nonexistent-command-12345")
            return yield* handle.exitCode
          }),
        ).pipe(Effect.provide(live)),
      )
      expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
    })
  })

  describe("pipeline", () => {
    test("pipes stdout of one command to stdin of another", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("hello world")').pipe(
            ChildProcess.pipeTo(
              js(
                'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.toUpperCase()))',
              ),
            ),
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("HELLO WORLD")
    })

    test("three-stage pipeline", async () => {
      const out = await runScoped(
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
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("HELLO-WORLD")
    })

    test("pipes stderr with { from: 'stderr' }", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stderr.write("error")').pipe(
            ChildProcess.pipeTo(
              js(
                'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
              ),
              { from: "stderr" },
            ),
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("error")
    })

    test("pipes combined output with { from: 'all' }", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n")').pipe(
            ChildProcess.pipeTo(
              js(
                'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
              ),
              { from: "all" },
            ),
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toContain("stdout")
      expect(out).toContain("stderr")
    })

    test("pipes output fd3 with { from: 'fd3' }", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('require("node:fs").writeSync(3, "hello from fd3\\n")', {
            additionalFds: { fd3: { type: "output" } },
          }).pipe(
            ChildProcess.pipeTo(
              js(
                'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
              ),
              { from: "fd3" },
            ),
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("hello from fd3")
    })

    test("pipes stdout to fd3", async () => {
      if (process.platform === "win32") return

      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("hello from stdout")').pipe(
            ChildProcess.pipeTo(js('process.stdout.write(require("node:fs").readFileSync(3, "utf8"))'), { to: "fd3" }),
          )
          const output = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return output
        }),
      )
      expect(out).toBe("hello from stdout")
    })
  })

  describe("additional fds", () => {
    test("reads data from output fd3", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('require("node:fs").writeSync(3, "hello from fd3\\n")', {
            additionalFds: { fd3: { type: "output" } },
          })
          const fd3Output = yield* decodeByteStream(handle.getOutputFd(3))
          yield* handle.exitCode
          return fd3Output
        }),
      )
      expect(out).toBe("hello from fd3")
    })

    test("writes data to input fd3", async () => {
      if (process.platform === "win32") return

      const out = await runScoped(
        Effect.gen(function* () {
          const input = Stream.make(new TextEncoder().encode("data from parent"))
          const handle = yield* js('process.stdout.write(require("node:fs").readFileSync(3, "utf8"))', {
            additionalFds: { fd3: { type: "input", stream: input } },
          })
          const stdout = yield* decodeByteStream(handle.stdout)
          yield* handle.exitCode
          return stdout
        }),
      )
      expect(out).toBe("data from parent")
    })

    test("returns empty stream for unconfigured fd", async () => {
      const out = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js('process.stdout.write("test")')
          const fd3Output = yield* decodeByteStream(handle.getOutputFd(3))
          yield* handle.exitCode
          return fd3Output
        }),
      )
      expect(out).toBe("")
    })

    test("works alongside normal stdout and stderr", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const handle = yield* js(
            'require("node:fs").writeSync(3, "fd3\\n"); process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n")',
            {
              additionalFds: { fd3: { type: "output" } },
            },
          )
          const stdout = yield* decodeByteStream(handle.stdout)
          const stderr = yield* decodeByteStream(handle.stderr)
          const fd3 = yield* decodeByteStream(handle.getOutputFd(3))
          yield* handle.exitCode
          return { stdout, stderr, fd3 }
        }),
      )
      expect(result.stdout).toBe("stdout")
      expect(result.stderr).toBe("stderr")
      expect(result.fd3).toBe("fd3")
    })
  })

  describe("large output", () => {
    test(
      "does not deadlock on large stdout",
      async () => {
        const out = await runScoped(
          Effect.gen(function* () {
            const handle = yield* js("for (let i = 1; i <= 100000; i++) process.stdout.write(`${i}\\n`)")
            const output = yield* handle.stdout.pipe(
              Stream.decodeText(),
              Stream.runFold(
                () => "",
                (acc, chunk) => acc + chunk,
              ),
            )
            yield* handle.exitCode
            return output
          }),
        )
        const lines = out.trim().split("\n")
        expect(lines.length).toBe(100000)
        expect(lines[0]).toBe("1")
        expect(lines[99999]).toBe("100000")
      },
      { timeout: 10_000 },
    )
  })

  describe("Windows-specific", () => {
    test("uses shell routing on Windows", async () => {
      if (process.platform !== "win32") return

      const out = await run(
        ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make("set", ["OPENCODE_TEST_SHELL"], {
              shell: true,
              extendEnv: true,
              env: { OPENCODE_TEST_SHELL: "ok" },
            }),
          ),
        ),
      )
      expect(out).toContain("OPENCODE_TEST_SHELL=ok")
    })

    test("runs cmd scripts with spaces on Windows without shell", async () => {
      if (process.platform !== "win32") return

      await using tmp = await tmpdir()
      const dir = path.join(tmp.path, "with space")
      const file = path.join(dir, "echo cmd.cmd")

      await fs.mkdir(dir, { recursive: true })
      await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

      const code = await run(
        ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.exitCode(
            ChildProcess.make(file, ["--stdio"], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            }),
          ),
        ),
      )
      expect(code).toBe(ChildProcessSpawner.ExitCode(0))
    })
  })
})
