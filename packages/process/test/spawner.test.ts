import { describe, expect, test } from "bun:test"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Layer, PlatformError, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ProcessSpawner } from "../src/spawner.ts"

const live = Layer.provide(ProcessSpawner.layer, Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
const fx = {
  live<A, E>(name: string, body: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope>) {
    test(name, () => Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(live))), 15_000)
  },
}

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "process-spawner-test-"))
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

describe("process spawner", () => {
  describe("basic spawning", () => {
    fx.live(
      "captures stdout",
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const out = yield* spawner.string(ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("ok")']))
        expect(out).toBe("ok")
      }),
    )

    fx.live(
      "captures multiple lines",
      Effect.gen(function* () {
        const handle = yield* js('console.log("line1"); console.log("line2"); console.log("line3")')
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("line1\nline2\nline3")
      }),
    )

    fx.live(
      "returns exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(0)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )

    fx.live(
      "returns non-zero exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(42)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(42))
      }),
    )
  })

  describe("cwd option", () => {
    fx.live(
      "uses cwd when spawning commands",
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const out = yield* spawner.string(
          ChildProcess.make(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: tmp.path }),
        )
        expect(yield* Effect.promise(() => fs.realpath(out))).toBe(yield* Effect.promise(() => fs.realpath(tmp.path)))
      }),
    )

    fx.live(
      "fails for invalid cwd",
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const exit = yield* Effect.exit(
          spawner.spawn(ChildProcess.make("echo", ["test"], { cwd: "/nonexistent/directory/path" })),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  describe("env option", () => {
    fx.live(
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

    fx.live(
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
    fx.live(
      "captures stderr output",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("error message")')
        const err = yield* decodeByteStream(handle.stderr)
        expect(err).toBe("error message")
      }),
    )

    fx.live(
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
    fx.live(
      "captures stdout via .all when no stderr",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello from stdout")')
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stdout")
      }),
    )

    fx.live(
      "captures stderr via .all when no stdout",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("hello from stderr")')
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stderr")
      }),
    )
  })

  describe("stdin", () => {
    fx.live(
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
    fx.live(
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

    fx.live(
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

    fx.live(
      "forceKillAfter escalates for stubborn processes",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* js(
              'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 10_000)',
            )
            yield* Stream.runHead(handle.stdout)
            yield* handle.kill({ forceKillAfter: 100 })
            return yield* handle.exitCode
          }),
        )

        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )

    fx.live(
      "isRunning reflects process state",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("done")')
        yield* handle.exitCode
        const running = yield* handle.isRunning
        expect(running).toBe(false)
      }),
    )

    fx.live(
      "unref returns a reusable ref effect",
      Effect.gen(function* () {
        const handle = yield* js("setInterval(() => {}, 10_000)")
        const ref = yield* handle.unref
        yield* handle.unref
        yield* ref
        yield* ref
        expect(yield* handle.isRunning).toBe(true)
        yield* handle.kill()
      }),
    )
  })

  describe("error handling", () => {
    fx.live(
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
    fx.live(
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

    fx.live(
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

    fx.live(
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

    fx.live(
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

    fx.live(
      "pipes additional output and input file descriptors",
      Effect.gen(function* () {
        const handle = yield* js('require("fs").writeSync(3, "extra")', {
          additionalFds: { fd3: { type: "output" } },
        }).pipe(
          ChildProcess.pipeTo(
            js(
              'const input = new (require("net").Socket)({fd: 4, readable: true, writable: false}); input.on("data", chunk => process.stdout.write(chunk))',
              { additionalFds: { fd4: { type: "input" } } },
            ),
            { from: "fd3", to: "fd4" },
          ),
        )
        expect(yield* decodeByteStream(handle.stdout)).toBe("extra")
        expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )
  })

  describe("Windows-specific", () => {
    fx.live(
      "uses shell routing on Windows",
      Effect.gen(function* () {
        if (process.platform !== "win32") return

        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const out = yield* spawner.string(
          ChildProcess.make("set", ["PROCESS_TEST_SHELL"], {
            shell: true,
            extendEnv: true,
            env: { PROCESS_TEST_SHELL: "ok" },
          }),
        )
        expect(out).toContain("PROCESS_TEST_SHELL=ok")
      }),
    )

    fx.live(
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

        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const code = yield* spawner.exitCode(
          ChildProcess.make(file, ["--stdio"], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          }),
        )
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )
  })
})

describe("foreground capability", () => {
  fx.live(
    "uses a custom spawner without substituting local execution",
    Effect.gen(function* () {
      const local = yield* ChildProcessSpawner.ChildProcessSpawner
      const command = ChildProcess.make(path.resolve("remote-only.exe"), [], { stdin: "ignore" })
      const spawner = ChildProcessSpawner.make((received) => {
        expect(received).toBe(command)
        return local.spawn(js('process.stdout.write("custom environment")'))
      })
      const child = yield* ProcessSpawner.startForeground(command, spawner)
      expect(yield* decodeByteStream(child.all)).toBe("custom environment")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "dispatches to the supplied foreground capability",
    Effect.gen(function* () {
      const local = yield* ChildProcessSpawner.ChildProcessSpawner
      const command = ChildProcess.make(path.resolve("remote-only.exe"), [], { stdin: "ignore" })
      const spawner: ProcessSpawner.Spawner = {
        ...ChildProcessSpawner.make(() => Effect.die("standard spawn must not be used")),
        spawnForeground(received) {
          expect(received).toBe(command)
          return local.spawn(js('process.stdout.write("custom foreground")'))
        },
      }
      const child = yield* ProcessSpawner.startForeground(command, spawner)
      expect(yield* decodeByteStream(child.all)).toBe("custom foreground")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "captures output and brands exit codes with the local capability",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        ChildProcess.make(
          process.execPath,
          ["-e", 'require("fs").writeSync(1,"stdout"); require("fs").writeSync(2,"stderr"); process.exit(7)'],
          { stdin: "ignore" },
        ),
        spawner,
      )
      expect(child.pid).toBeGreaterThan(0)
      expect("stdin" in child).toBe(process.platform !== "win32")
      expect("unref" in child).toBe(process.platform !== "win32")
      const output = yield* decodeByteStream(child.all)
      expect(output).toContain("stdout")
      expect(output).toContain("stderr")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(7))
    }),
  )

  fx.live(
    "keeps bare executable paths on standard execution",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        js('process.stdout.write("bare")', { stdin: "ignore" }),
        spawner,
      )
      expect("stdin" in child).toBe(true)
      expect("unref" in child).toBe(true)
      expect(yield* decodeByteStream(child.all)).toBe("bare")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "keeps unsupported stdin on standard execution",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        ChildProcess.make(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
          stdin: Stream.make(Buffer.from("input")),
        }),
        spawner,
      )
      expect("stdin" in child).toBe(true)
      expect(yield* decodeByteStream(child.all)).toBe("input")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "keeps ignored output on standard execution",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("discarded"); process.stderr.write("kept")'], {
          stdin: "ignore",
          stdout: "ignore",
        }),
        spawner,
      )
      expect("stdin" in child).toBe(true)
      expect(yield* decodeByteStream(child.all)).toBe("kept")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "preserves cwd and environment options",
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        ChildProcess.make(
          process.execPath,
          ["-e", 'process.stdout.write(process.cwd()+"\\n"+process.env.PROCESS_TEST)'],
          {
            stdin: "ignore",
            cwd: tmp.path,
            env: { PROCESS_TEST: "foreground" },
            extendEnv: true,
          },
        ),
        spawner,
      )
      const output = yield* decodeByteStream(child.all)
      const [directory, value] = output.split("\n")
      expect(yield* Effect.promise(() => fs.realpath(directory))).toBe(
        yield* Effect.promise(() => fs.realpath(tmp.path)),
      )
      expect(value).toBe("foreground")
      expect(yield* child.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  fx.live(
    "reports startup failures as PlatformError",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const error = yield* Effect.flip(
        ProcessSpawner.startForeground(
          ChildProcess.make(path.resolve("nonexistent-foreground-12345.exe"), [], { stdin: "ignore" }),
          spawner,
        ),
      )
      expect(error).toBeInstanceOf(PlatformError.PlatformError)
      expect(error.reason.module).toBe("ChildProcess")
    }),
  )

  fx.live(
    "kills a running foreground process",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* ProcessSpawner.startForeground(
        ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], { stdin: "ignore" }),
        spawner,
      )
      yield* child.kill()
      expect(yield* Effect.promise(() => gone(child.pid))).toBe(true)
    }),
  )

  fx.live(
    "terminates a running foreground process at scope exit",
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const pid = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* ProcessSpawner.startForeground(
            ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], { stdin: "ignore" }),
            spawner,
          )
          return child.pid
        }),
      )
      expect(yield* Effect.promise(() => gone(pid))).toBe(true)
    }),
  )
})
