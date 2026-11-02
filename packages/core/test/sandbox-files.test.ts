import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppProcess } from "@opencode/util/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { EnvironmentFiles } from "../src/environment/files"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Project } from "../src/project"
import { ChildProcess } from "effect/process"
import { Sandbox } from "../src/sandbox"
import { MacSandbox } from "../src/sandbox/macos"
import { SandboxFiles } from "../src/sandbox/files"
import { SandboxFileProtocol } from "../src/sandbox/file-protocol"
import { SandboxFileWorker } from "../src/sandbox/file-worker"
import { tmpdirScoped } from "./fixture/tmpdir"
import { environmentConformance } from "./lib/environment-conformance"
import { it, testEffect } from "./lib/effect"

const processLayer = LayerNode.compile(AppProcess.node)
const live = testEffect(processLayer)
// This fixture exercises macOS bootstrap flags, /dev/null, and POSIX filenames/symlinks.
const transport = process.platform === "win32" ? live.live.skip : live.live
const macos = process.platform === "darwin" ? live.live : live.live.skip
const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const kernel = probe?.exitCode === 0 ? live.live : live.live.skip
if (probe && probe.exitCode !== 0)
  console.warn(`Confined file integration tests unavailable: ${probe.stderr.toString().trim()}`)

function fixture(confined = false, fullDiskRead = false) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-files-")
    const host = {
      directory: path.join(tmp.path, "workspace"),
      scratch: path.join(tmp.path, "scratch"),
      home: path.join(tmp.path, "home"),
      config: path.join(tmp.path, "config"),
      data: path.join(tmp.path, "data"),
      state: path.join(tmp.path, "state"),
    }
    yield* Effect.promise(() => Promise.all(Object.values(host).map((value) => fs.mkdir(value))))
    const policy = yield* Effect.promise(() => MacSandbox.policy(host, { fullDiskRead }))
    const launch = MacSandbox.fileLaunch(
      policy,
      yield* Effect.promise(() => fs.realpath(process.execPath)),
      SandboxFileWorker.configured(policy),
    )
    const separator = launch.args.indexOf("--")
    // Protocol tests use the real worker/bootstrap but intentionally do not claim OS confinement.
    const command = confined
      ? launch
      : { ...launch, command: launch.args[separator + 1], args: launch.args.slice(separator + 2) }
    const subprocess = yield* AppProcess.Service
    return {
      root: host.directory,
      host,
      launch: command,
      process: subprocess,
      files: SandboxFiles.make({ process: subprocess, launch: command, directory: host.directory, cwd: host.scratch }),
      symlink: (target: string, link: string) =>
        Effect.tryPromise({
          try: () => fs.symlink(target, link),
          catch: (cause) => new EnvironmentFiles.Failed({ path: link, cause }),
        }),
    }
  })
}

environmentConformance(
  "file helper protocol (without Seatbelt)",
  () => fixture().pipe(Effect.provide(processLayer)),
  process.platform === "win32",
)
environmentConformance(
  "Seatbelt file helper",
  () => fixture(true).pipe(Effect.provide(processLayer)),
  probe?.exitCode !== 0,
)

transport("binary data and hostile filenames remain data across the helper boundary", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const target = path.join(helper.root, 'quotes"\n$(touch escaped) ; file')
    const bytes = Uint8Array.from([0, 255, 128, 10, 13, 0, 42])
    yield* helper.files.write(target, bytes)
    expect((yield* helper.files.read(target)).bytes).toEqual(bytes)
    expect((yield* helper.files.read(target, { offset: 1, length: 3 })).bytes).toEqual(bytes.slice(1, 4))
    expect(yield* Effect.promise(() => awaitExists(path.join(helper.host.scratch, "escaped")))).toBe(false)
  }),
)

transport("helper startup ignores workspace and scratch configuration and does not forward harness secrets", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const marker = path.join(helper.host.scratch, "injected")
    for (const directory of [helper.host.directory, helper.host.scratch]) {
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(directory, "inject.js"),
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "injected")`,
        ),
      )
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "bunfig.toml"), 'preload = ["./inject.js"]'))
      yield* Effect.promise(() => fs.writeFile(path.join(directory, ".env"), 'BUN_OPTIONS="--preload ./inject.js"'))
    }
    expect(
      Object.keys(helper.launch.env).some((name) => /TOKEN|SECRET|OPENCODE_|NODE_OPTIONS|BUN_OPTIONS/.test(name)),
    ).toBe(false)
    yield* helper.files.write("relative-file", new Uint8Array([1]))
    expect((yield* helper.files.stat("relative-file")).size).toBe(1)
    expect(yield* Effect.promise(() => awaitExists(marker))).toBe(false)
  }),
)

transport("whole-file reads are bounded while byte ranges can read a larger file", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const target = path.join(helper.root, "large")
    yield* Effect.promise(async () => {
      const file = await fs.open(target, "w")
      try {
        await file.truncate(SandboxFileProtocol.MAX_DATA_BYTES + 1)
      } finally {
        await file.close()
      }
    })
    expect(yield* Effect.flip(helper.files.read(target))).toBeInstanceOf(EnvironmentFiles.Failed)
    expect((yield* helper.files.read(target, { offset: SandboxFileProtocol.MAX_DATA_BYTES, length: 1 })).bytes).toEqual(
      new Uint8Array([0]),
    )
  }),
)

transport("moving into a directory keeps the existing Environment contract", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    yield* helper.files.mkdir("destination")
    yield* helper.files.write("source", new Uint8Array([7]))
    yield* helper.files.move("source", "destination")
    expect((yield* helper.files.read("destination/source")).bytes).toEqual(new Uint8Array([7]))
    expect(yield* Effect.flip(helper.files.move("destination/source", "missing-parent/file"))).toBeInstanceOf(
      EnvironmentFiles.Failed,
    )
    expect((yield* helper.files.read("destination/source")).bytes).toEqual(new Uint8Array([7]))
  }),
)

transport("the worker validates requests independently before mutation", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const target = path.join(helper.root, "should-not-exist", "file")
    for (const request of [
      { op: "write", path: target, data: "?invalid-base64" },
      { op: "write", path: "relative", data: "" },
      { op: "read", path: target, range: { offset: Number.MAX_SAFE_INTEGER, length: 1 } },
    ]) {
      const reply = yield* helper.process.run(
        ChildProcess.make(helper.launch.command, helper.launch.args, {
          cwd: helper.host.scratch,
          env: helper.launch.env,
          extendEnv: false,
        }),
        { stdin: JSON.stringify(request), maxOutputBytes: 8192, maxErrorBytes: 8192 },
      )
      expect(JSON.parse(reply.stdout.toString())).toMatchObject({ op: "error", kind: "Failed" })
    }
    expect(yield* Effect.promise(() => awaitExists(path.dirname(target)))).toBe(false)
  }),
)

it.effect("invalid ranges fail before a helper is spawned", () =>
  Effect.gen(function* () {
    let calls = 0
    const files = SandboxFiles.make({
      process: {
        run: () => {
          calls++
          return Effect.die("Unexpected spawn")
        },
      },
      launch: { command: "unused", args: [], env: {} },
      directory: "/workspace",
      cwd: "/scratch",
    })
    for (const range of [
      { offset: -1, length: 1 },
      { offset: 0, length: 1.5 },
      { offset: 0, length: SandboxFileProtocol.MAX_DATA_BYTES + 1 },
      { offset: Number.MAX_SAFE_INTEGER, length: 1 },
    ])
      expect(yield* Effect.flip(files.read("file", range))).toBeInstanceOf(EnvironmentFiles.Failed)
    expect(calls).toBe(0)
  }),
)

it.effect("malformed, mismatched, truncated, and failed replies never become successful file operations", () =>
  Effect.gen(function* () {
    for (const input of [
      { stdout: "not json" },
      { stdout: '{"op":"mkdir"}' },
      { stdout: '{"op":"read","info":{"type":"file","size":1,"mtimeMs":0},"data":"?"}' },
      { stdout: '{"op":"write"}', stdoutTruncated: true },
      { stdout: '{"op":"write"}', exitCode: 1 },
    ]) {
      const files = SandboxFiles.make({
        process: {
          run: () =>
            Effect.succeed({
              command: "test",
              stdout: Buffer.from(input.stdout),
              stderr: Buffer.alloc(0),
              exitCode: input.exitCode ?? 0,
              stdoutTruncated: input.stdoutTruncated ?? false,
              stderrTruncated: false,
            }),
        },
        launch: { command: "unused", args: [], env: {} },
        directory: "/workspace",
        cwd: "/scratch",
      })
      expect(yield* Effect.flip(files.read("file"))).toBeInstanceOf(EnvironmentFiles.Failed)
    }
  }),
)

it.live("interrupting a helper operation releases its process scope", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    let released = false
    const files = SandboxFiles.make({
      process: {
        run: () =>
          Effect.acquireUseRelease(
            Deferred.succeed(started, undefined),
            () => Effect.never,
            () =>
              Effect.sync(() => {
                released = true
              }),
          ),
      },
      launch: { command: "unused", args: [], env: {} },
      directory: "/workspace",
      cwd: "/scratch",
    })
    const running = yield* files.read("file").pipe(Effect.forkChild)
    yield* Deferred.await(started)
    yield* Fiber.interrupt(running)
    expect(released).toBe(true)
  }),
)

transport("a failed helper cannot fall back to reading or writing the host filesystem", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const target = path.join(helper.root, "host-file")
    yield* Effect.promise(() => fs.writeFile(target, "original"))
    const files = SandboxFiles.make({
      process: helper.process,
      launch: { command: path.join(helper.root, "missing-helper"), args: [], env: {} },
      directory: helper.root,
      cwd: helper.host.scratch,
    })
    expect(yield* Effect.flip(files.read(target))).toBeInstanceOf(EnvironmentFiles.Failed)
    expect(yield* Effect.flip(files.write(target, new Uint8Array([9])))).toBeInstanceOf(EnvironmentFiles.Failed)
    expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("original")
  }),
)

for (const fullDiskRead of [false, true]) {
  kernel(`helper enforces filesystem policy with fullDiskRead=${fullDiskRead}`, () =>
    Effect.gen(function* () {
      const helper = yield* fixture(true, fullDiskRead)
      const outside = path.join(helper.host.home, "outside")
      const credentials = path.join(helper.host.home, ".ssh")
      yield* Effect.promise(async () => {
        await fs.mkdir(credentials)
        await fs.writeFile(path.join(credentials, "key"), "secret")
        await fs.writeFile(path.join(helper.host.config, "secret"), "control")
        await fs.writeFile(outside, "public")
        await fs.symlink(helper.host.home, path.join(helper.root, "link"), "dir")
      })
      yield* helper.files.write("local", new Uint8Array([1]))
      expect((yield* helper.files.read("local")).bytes).toEqual(new Uint8Array([1]))
      const read = yield* Effect.result(helper.files.read(outside))
      expect(read._tag).toBe(fullDiskRead ? "Success" : "Failure")
      for (const target of [path.join(credentials, "key"), path.join(helper.host.config, "secret"), "link/.ssh/key"])
        expect(yield* Effect.flip(helper.files.read(target))).toBeInstanceOf(EnvironmentFiles.Failed)
      for (const target of [outside, "link/escape", ".opencode/plugin.js", "opencode.json"])
        expect(yield* Effect.flip(helper.files.write(target, new Uint8Array([2])))).toBeInstanceOf(
          EnvironmentFiles.Failed,
        )
      expect(yield* Effect.flip(helper.files.move("local", outside))).toBeInstanceOf(EnvironmentFiles.Failed)
      expect((yield* helper.files.read("local")).bytes).toEqual(new Uint8Array([1]))
      // The host binding is intentionally still available for trusted harness operations.
      expect(yield* Effect.promise(() => fs.readFile(path.join(credentials, "key"), "utf8"))).toBe("secret")
    }),
  )
}

kernel("the configured service exposes a confined binding without replacing trusted host I/O", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    yield* Effect.promise(() => fs.writeFile(path.join(helper.host.config, "secret"), "control"))
    yield* Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const files = yield* sandbox.files
      yield* files.write("from-service", new Uint8Array([3]))
      expect((yield* files.read("from-service")).bytes).toEqual(new Uint8Array([3]))
      expect(yield* Effect.flip(files.read(path.join(helper.host.config, "secret")))).toBeInstanceOf(
        EnvironmentFiles.Failed,
      )
    }).pipe(
      Effect.provide(
        LayerNode.compile(Sandbox.configured({ enabled: true }), {
          replacements: [
            Global.node.replace(
              Global.layerWith({
                ...helper.host,
                tmp: helper.host.scratch,
                log: path.join(helper.host.data, "log"),
                bin: path.join(helper.host.data, "bin"),
                repos: path.join(helper.host.data, "repos"),
              }),
            ),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of({
                  directory: AbsolutePath.make(helper.root),
                  project: {
                    id: Project.ID.make("test"),
                    directory: AbsolutePath.make(helper.root),
                    canonical: AbsolutePath.make(helper.root),
                  },
                }),
              ),
            ),
          ],
        }),
      ),
    )
    expect(yield* Effect.promise(() => fs.readFile(path.join(helper.root, "from-service")))).toEqual(Buffer.from([3]))
  }),
)

it.live("the service refuses a confined file binding when sandboxing is disabled", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const service = yield* Sandbox.Service.pipe(
      Effect.provide(
        LayerNode.compile(Sandbox.node, {
          replacements: [
            Global.node.replace(
              Global.layerWith({
                tmp: tmp.path,
                data: path.join(tmp.path, "data"),
                config: path.join(tmp.path, "config"),
                state: path.join(tmp.path, "state"),
                log: path.join(tmp.path, "log"),
                bin: path.join(tmp.path, "bin"),
                repos: path.join(tmp.path, "repos"),
              }),
            ),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of({
                  directory: AbsolutePath.make(tmp.path),
                  project: {
                    id: Project.ID.make("test"),
                    directory: AbsolutePath.make(tmp.path),
                    canonical: AbsolutePath.make(tmp.path),
                  },
                }),
              ),
            ),
          ],
        }),
      ),
    )
    expect(yield* Effect.flip(service.files)).toBeInstanceOf(Sandbox.UnavailableError)
  }),
)

macos("configured search copies only its executable and protects it in the shell policy", () =>
  Effect.gen(function* () {
    const helper = yield* fixture()
    const executable = path.join(helper.host.data, "managed-rg")
    yield* Effect.promise(() => fs.writeFile(executable, "trusted binary bytes"))
    yield* Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const launch = yield* sandbox.search(executable)
      const again = yield* sandbox.search(executable)
      expect(again).toEqual(launch)
      const binary = launch.args[launch.args.indexOf("--") + 1]
      expect(binary).toContain(`${path.sep}.runtime${path.sep}`)
      expect(yield* Effect.promise(() => fs.readFile(binary, "utf8"))).toBe("trusted binary bytes")
      expect(launch.env).toEqual({ PATH: "/usr/bin:/bin", HOME: launch.env.HOME, TMPDIR: launch.env.HOME })
      const shell = yield* sandbox.prepare(
        { shell: "/bin/sh", command: "true", env: {}, cwd: helper.root, timeout: 30_000 },
        false,
      )
      expect(shell.args.some((arg) => arg.startsWith("-DPROTECTED_") && arg.endsWith(`${path.sep}.runtime`))).toBe(true)
      expect(launch.args.some((arg) => arg.startsWith("-DREAD_") && arg.endsWith(helper.host.data))).toBe(false)
    }).pipe(
      Effect.provide(
        LayerNode.compile(Sandbox.configured({ enabled: true }), {
          replacements: [
            Global.node.replace(Global.layerWith({ ...helper.host, tmp: helper.host.scratch })),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of({
                  directory: AbsolutePath.make(helper.root),
                  project: {
                    id: Project.ID.make("test"),
                    directory: AbsolutePath.make(helper.root),
                    canonical: AbsolutePath.make(helper.root),
                  },
                }),
              ),
            ),
          ],
        }),
      ),
    )
  }),
)

function awaitExists(value: string) {
  return fs.access(value).then(
    () => true,
    () => false,
  )
}
