import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { MacSandbox } from "../src/sandbox/macos"
import { SandboxPolicy } from "../src/sandbox/policy"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const clang = Bun.which("clang")
const kernel = probe?.exitCode === 0 && clang ? it.live : it.live.skip
const node = Bun.which("node")
const python = Bun.which("/opt/homebrew/bin/python3") ?? Bun.which("python3")
const formatter = Bun.which("clang-format")

const fixture = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped("opencode-sandbox-runtime-")
  const host = {
    directory: path.join(tmp.path, "workspace"),
    scratch: path.join(tmp.path, "scratch"),
    home: path.join(tmp.path, "home"),
    config: path.join(tmp.path, "config"),
    data: path.join(tmp.path, "data"),
    state: path.join(tmp.path, "state"),
  }
  yield* Effect.promise(() => Promise.all(Object.values(host).map((value) => fs.mkdir(value))))
  const run = (policy: SandboxPolicy.Policy, command: string, args: string[]) => {
    const launch = MacSandbox.launch(policy, command, args, SandboxPolicy.environment(process.env, host.scratch))
    return Bun.spawnSync([launch.command, ...launch.args], { cwd: host.directory, env: launch.env })
  }
  return { host, run }
})

kernel(
  "sysctl policy permits CPU/OS discovery but blocks named and numeric host-process queries in both read modes",
  () =>
    Effect.gen(function* () {
      if (!clang) return yield* Effect.die("Clang is unavailable")
      const f = yield* fixture
      const binary = path.join(f.host.directory, "sysctl-probe")
      const compiled = Bun.spawnSync([
        clang,
        "-Wall",
        "-Wextra",
        "-Werror",
        path.join(import.meta.dir, "fixture/sandbox-sysctl.c"),
        "-o",
        binary,
      ])
      expect({ exit: compiled.exitCode, stderr: compiled.stderr.toString() }).toMatchObject({ exit: 0 })
      const marker = "opencode-sysctl-private-process-canary"
      const external = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([binary, "hold", "opencode-sysctl-private-argument-canary"], {
            env: { PRIVATE_PROCESS_CANARY: marker },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "ignore",
          }),
        ),
        (child) =>
          Effect.promise(async () => {
            child.stdin.end()
            await child.exited
          }),
      )
      const ready = external.stdout.getReader()
      const first = yield* Effect.promise(() => ready.read())
      expect(new TextDecoder().decode(first.value)).toBe("ready\n")
      ready.releaseLock()
      for (const fullDiskRead of [false, true]) {
        const policy = yield* Effect.promise(() => MacSandbox.policy(f.host, { fullDiskRead }))
        for (const name of ["hw.ncpu", "hw.pagesize", "hw.memsize", "kern.osrelease", "vm.loadavg"]) {
          const control = Bun.spawnSync([binary, name])
          expect({ name, exit: control.exitCode, stderr: control.stderr.toString() }).toMatchObject({ exit: 0 })
          const result = f.run(policy, binary, [name])
          expect({ name, exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exit: 0 })
          expect(result.stdout.toString()).toBe("query allowed\n")
        }
        for (const args of [
          ["kern.boottime"],
          ["processes"],
          ["rename"],
          ["procargs", String(external.pid), marker],
          ["procargs", String(external.pid), "opencode-sysctl-private-argument-canary"],
          ["signal", String(external.pid)],
        ]) {
          const control = Bun.spawnSync([binary, ...args])
          expect({ args: args[0], exit: control.exitCode, stderr: control.stderr.toString() }).toMatchObject({
            exit: 0,
          })
          const result = f.run(policy, binary, args)
          expect({
            query: args[0],
            fullDiskRead,
            exit: result.exitCode,
            output: result.stdout.toString(),
          }).toMatchObject({ exit: 1 })
          expect(result.stderr.toString()).toBe("query denied: 1\n")
          expect(result.stdout.toString()).toBe("")
        }
        const self = f.run(policy, binary, ["procargs", "self", "opencode-self-argument-canary"])
        expect({ exit: self.exitCode, stderr: self.stderr.toString() }).toMatchObject({ exit: 0 })
        expect(self.stdout.toString()).toBe("marker visible\n")
        const child = f.run(policy, binary, ["child", "opencode-child-argument-canary"])
        expect({ exit: child.exitCode, stderr: child.stderr.toString() }).toMatchObject({ exit: 0 })
        expect(child.stdout.toString()).toBe("marker visible\n")
        for (const args of [["-n", "hw.ncpu"], ["hw.ncpu"]]) {
          const result = f.run(policy, "/usr/sbin/sysctl", args)
          expect({ args, exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({
            exit: 0,
            stderr: "",
          })
          expect(result.stdout.toString()).toMatch(args.length === 2 ? /^\d+\n$/ : /^hw\.ncpu: \d+\n$/)
        }
        // sysctl(8) may exit successfully with no output for a denied value.
        expect(f.run(policy, "/usr/sbin/sysctl", ["-n", "kern.boottime"]).stdout.toString()).toBe("")
        // Numeric metadata operations: 1=name, 2=next, 4=format, 5=description.
        for (const [oid, key, allowed] of [
          [1, "hw.ncpu", true],
          [4, "hw.ncpu", true],
          [1, "kern.procargs2", true],
          [2, "hw.ncpu", false],
          [5, "hw.ncpu", false],
        ] as const) {
          const control = Bun.spawnSync([binary, "metadata", String(oid), key])
          expect({ oid, key, exit: control.exitCode, stderr: control.stderr.toString() }).toMatchObject({ exit: 0 })
          const result = f.run(policy, binary, ["metadata", String(oid), key])
          expect({ oid, key, exit: result.exitCode }).toMatchObject({ exit: allowed ? 0 : 1 })
          if (!allowed) expect(result.stderr.toString()).toBe("query denied: 1\n")
        }
      }
    }),
)

kernel("the runtime allowlist preserves sandboxed C compilation and child execution", () =>
  Effect.gen(function* () {
    if (!clang) return yield* Effect.die("Clang is unavailable")
    const f = yield* fixture
    const source = path.join(f.host.directory, "hello.c")
    yield* Effect.promise(() =>
      fs.writeFile(source, '#include <stdio.h>\nint main(void) { puts("compiled in sandbox"); }\n'),
    )
    for (const fullDiskRead of [false, true]) {
      const policy = yield* Effect.promise(() => MacSandbox.policy(f.host, { fullDiskRead }))
      const binary = path.join(f.host.directory, `hello-${fullDiskRead}`)
      const compiled = f.run(policy, clang, [source, "-o", binary])
      expect({ exit: compiled.exitCode, stderr: compiled.stderr.toString() }).toMatchObject({ exit: 0 })
      const result = f.run(policy, binary, [])
      expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exit: 0 })
      expect(result.stdout.toString()).toBe("compiled in sandbox\n")
      const identity = f.run(policy, "/usr/bin/id", ["-un"])
      expect({ exit: identity.exitCode, stderr: identity.stderr.toString() }).toMatchObject({ exit: 0 })
      expect(identity.stdout.toString().trim().length).toBeGreaterThan(0)
    }
  }),
)

const nodeKernel = probe?.exitCode === 0 && node ? it.live : it.live.skip
nodeKernel("Node CPU discovery and worker threads work with the selective sysctl policy", () =>
  Effect.gen(function* () {
    if (!node) return yield* Effect.die("Node is unavailable")
    const f = yield* fixture
    const runtime = yield* Effect.promise(() => fs.realpath(node))
    const program = `
      const assert = require('node:assert/strict');
      const os = require('node:os');
      const { Worker } = require('node:worker_threads');
      assert(os.cpus().length > 0);
      assert(os.availableParallelism() > 0);
      assert(os.totalmem() > 0);
      assert(os.hostname());
      assert.equal(os.loadavg().length, 3);
      new Worker('require("node:worker_threads").parentPort.postMessage(42)', { eval: true })
        .on('message', (value) => { assert.equal(value, 42); console.log('runtime ready'); });
    `
    for (const fullDiskRead of [false, true]) {
      const policy = yield* Effect.promise(() => MacSandbox.policy(f.host, { fullDiskRead, readableRoots: [runtime] }))
      const result = f.run(policy, node, ["-e", program])
      expect({ exit: result.exitCode, signal: result.signalCode, stderr: result.stderr.toString() }).toMatchObject({
        exit: 0,
      })
      expect(result.stdout.toString()).toBe("runtime ready\n")
    }
  }),
)

const pythonKernel = probe?.exitCode === 0 && python ? it.live : it.live.skip
pythonKernel("Python CPU discovery and thread pools work with the selective sysctl policy", () =>
  Effect.gen(function* () {
    if (!python) return yield* Effect.die("Python is unavailable")
    const f = yield* fixture
    const runtime = yield* Effect.promise(() => fs.realpath(python))
    const program = `
import os
from concurrent.futures import ThreadPoolExecutor
assert os.cpu_count() > 0
with ThreadPoolExecutor(max_workers=2) as executor:
    assert list(executor.map(abs, [-1, -2])) == [1, 2]
print("runtime ready")
`
    for (const fullDiskRead of [false, true]) {
      const policy = yield* Effect.promise(() => MacSandbox.policy(f.host, { fullDiskRead, readableRoots: [runtime] }))
      const result = f.run(policy, python, ["-I", "-B", "-c", program])
      expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exit: 0 })
      expect(result.stdout.toString()).toBe("runtime ready\n")
    }
  }),
)

const formatterKernel = probe?.exitCode === 0 && formatter ? it.live : it.live.skip
formatterKernel("installed clang-format runs with the selective sysctl policy", () =>
  Effect.gen(function* () {
    if (!formatter) return yield* Effect.die("clang-format is unavailable")
    const f = yield* fixture
    const runtime = yield* Effect.promise(() => fs.realpath(formatter))
    for (const fullDiskRead of [false, true]) {
      const source = path.join(f.host.directory, "hello.c")
      yield* Effect.promise(() => fs.writeFile(source, "int main(){return 0;}\n"))
      const policy = yield* Effect.promise(() => MacSandbox.policy(f.host, { fullDiskRead, readableRoots: [runtime] }))
      const result = f.run(policy, formatter, ["--style=LLVM", "-i", source])
      expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exit: 0 })
      expect(yield* Effect.promise(() => fs.readFile(source, "utf8"))).toBe("int main() { return 0; }\n")
    }
  }),
)
