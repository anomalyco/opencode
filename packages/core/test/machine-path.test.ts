import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { AppProcess } from "@opencode/util/process"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Formatter } from "@opencode/core/formatter"
import { Image } from "@opencode/core/image"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { Machine } from "@opencode/core/machine/index"
import { MachinePath } from "@opencode/core/machine/path"
import { Machines } from "@opencode/core/machine/machines"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { GlobTool } from "@opencode/core/tool/plugin/glob"
import { GrepTool } from "@opencode/core/tool/plugin/grep"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import type { ChildProcess } from "effect/process"
import { makeWorker } from "./fixture/machine-worker"
import { location } from "./fixture/location"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { tempGlobalLayer } from "./fixture/global"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_machine_path_test")

const toolPlugins = makeLocationNode({
  name: "test/machine-path-tools",
  layer: Layer.effectDiscard(
    Effect.all(
      [
        registerToolPlugin(ReadTool.Plugin),
        registerToolPlugin(WriteTool.Plugin),
        registerToolPlugin(EditTool.Plugin),
        registerToolPlugin(PatchTool.Plugin),
        registerToolPlugin(ShellTool.Plugin),
        registerToolPlugin(GrepTool.Plugin),
        registerToolPlugin(GlobTool.Plugin),
      ],
      { discard: true },
    ),
  ),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    FileMutation.node,
    FileWrite.node,
    Flag.node,
    Formatter.node,
    FSUtil.node,
    Image.node,
    InstructionDiscovery.node,
    Job.node,
    Location.node,
    Permission.node,
    PersistentPty.node,
    Ripgrep.node,
    Session.node,
    SessionInstructions.node,
    Shell.node,
    Shell.daemonNode,
    ShellSelect.node,
    Skill.node,
    Tool.node,
  ],
})

const revert: Session.Interface["revert"] = {
  stage: () => Effect.die("unused"),
  clear: () => Effect.die("unused"),
  commit: () => Effect.die("unused"),
}

interface Fixture {
  readonly directory: string
  readonly assertions: Permission.AssertInput[]
  readonly processes: ChildProcess.Command[]
}

const graph = (fixture: Fixture) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      toolPlugins,
      FileAccess.node,
      FileMutation.node,
      Flag.node,
      Formatter.node,
      Location.node,
      Machines.node,
      PluginHooks.node,
      ShellSelect.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(fixture.directory) })),
        ),
      ),
      AppProcess.node.replace(
        Layer.effect(
          AppProcess.Service,
          Effect.gen(function* () {
            const processes = yield* AppProcess.Service
            return AppProcess.Service.of({
              ...processes,
              run: (command, options) =>
                Effect.sync(() => void fixture.processes.push(command)).pipe(
                  Effect.andThen(processes.run(command, options)),
                ),
            })
          }),
        ).pipe(Layer.provide(LayerNode.compile(AppProcess.node))),
      ),
      Permission.node.replace(
        permissionLayer({
          assert: (input) => Effect.sync(() => void fixture.assertions.push(input)),
        }),
      ),
      PersistentPty.node.replace(disabledPersistentPtyLayer),
      Session.node.replace(Layer.mock(Session.Service, { revert })),
      Config.node.replace(Config.testLayer()),
      Global.node.replace(tempGlobalLayer),
    ],
  )

const fixture = (directory: string): Fixture => ({ directory, assertions: [], processes: [] })

const connected = (machines: Machines.Interface, name: string) =>
  Effect.gen(function* () {
    const id = yield* machines.add(name)
    const worker = yield* makeWorker({ connect: (connection) => machines.connect(id, connection) })
    yield* worker.restore
    return { id, worker }
  })

const call = (name: string, input: unknown, id = `call-${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const text = (value: Uint8Array) => new TextDecoder().decode(value)
const bytes = (value: string) => new TextEncoder().encode(value)
const slash = (value: string) => value.replaceAll("\\", "/")

const on = testEffect(Layer.succeed(Flag.Overrides, "machines"))
const off = testEffect(Layer.succeed(Flag.Overrides, "-machines"))

describe("MachinePath", () => {
  const machinePaths: ReadonlyArray<readonly [string, { machine: string; path: string } | undefined]> = [
    ["gpu:/work/train.py", { machine: "gpu", path: "/work/train.py" }],
    ["gpu:/work/../a", { machine: "gpu", path: "/work/../a" }],
    ["gpu-2:/x", { machine: "gpu-2", path: "/x" }],
    ["gpu:/a//b", { machine: "gpu", path: "/a//b" }],
    ["gpu:/", { machine: "gpu", path: "/" }],
    ["gpu:~/notes", { machine: "gpu", path: "~/notes" }],
    ["gpu:~", { machine: "gpu", path: "~" }],
    ["C:/Users/x", undefined],
    ["C:\\x", undefined],
    ["skill://thing", undefined],
    ["file:///x", undefined],
    ["https://host/x", undefined],
    ["local:/x", undefined],
    ["gpu:relative", undefined],
    ["gpu:", undefined],
    ["/plain/path", undefined],
    ["relative/a:b/c", undefined],
    [":only", undefined],
    ["A:/x", undefined],
    ["todo:list.txt", undefined],
  ]

  const plain = (parsed: ReturnType<typeof MachinePath.parse>) =>
    parsed && { machine: `${parsed.machine}`, path: `${parsed.path}` }

  for (const [input, expected] of machinePaths)
    test(`parse ${JSON.stringify(input)}`, () => expect(plain(MachinePath.parse(input))).toEqual(expected))
})

off.effect("resolves a machine-shaped path exactly as a local path with the flag off", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const location = yield* Location.Service
      const target = yield* access.resolve({ path: "gpu:/work/a" })
      expect(`${target.absolute}`).toBe(FileAccess.resolvePath(location.directory, "gpu:/work/a"))
      expect(`${target.absolute}`).toBe(path.join(tmp.path, "gpu:/work/a"))
      // With machines off there is no machine to collide with, so the name is exactly what it was.
      expect(target.resource).toBe("gpu:/work/a")
      expect(target.externalDirectory).toBeUndefined()
      expect(target.environment.id).toBe(Environment.localID)

      // No machine's home is asked for either: `gpu:~` is a local folder like any other.
      const home = yield* access.resolve({ path: "gpu:~/x" })
      expect(`${home.absolute}`).toBe(FileAccess.resolvePath(location.directory, "gpu:~/x"))
      expect(`${home.absolute}`).toBe(path.join(tmp.path, "gpu:~/x"))
      expect(home.resource).toBe("gpu:~/x")
      expect(home.environment.id).toBe(Environment.localID)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

off.effect("refuses a home on a base in another environment with the flag off, asking no machine for it", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      // Connected, so only the flag keeps its home from being read.
      const { id } = yield* connected(machines, "gpu")
      const access = yield* FileAccess.Service
      for (const text of ["~", "~/x"])
        expect(
          (yield* access.locate(text, { absolute: AbsolutePath.make("/work"), environment: { id } }).pipe(Effect.flip))
            .cause,
        ).toBeInstanceOf(MachinePath.NotAbsolute)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("locates a machine path from its text, rejecting another user's home there", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const place = yield* access.locate("gpu:/work/../train.py")
      expect(`${place.absolute}`).toBe("/train.py")
      expect(place.environment.id).toBe(Environment.ID.make("gpu"))

      for (const refused of ["gpu:~other/notes", "gpu:~+", "gpu:~+/notes", "gpu:~~"])
        expect((yield* access.locate(refused).pipe(Effect.flip)).cause).toBeInstanceOf(MachinePath.NotAbsolute)
      // A home is asked of the machine list, which knows no gpu here.
      expect((yield* access.locate("gpu:~/notes").pipe(Effect.flip)).cause).toBeInstanceOf(Machines.NotFound)

      // Only `name:/` and `name:~` are read as a machine: a relative rest stays this server's own path.
      const relative = yield* access.locate("gpu:relative")
      expect(`${relative.absolute}`).toBe(path.join(tmp.path, "gpu:relative"))
      expect(relative.environment.id).toBe(Environment.localID)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reads, writes, edits, patches and lists a machine's files, leaving this server's disk alone", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      // A repository marker above the machine's directory: the saved rule stays the directory's own glob.
      yield* machine.files.mkdir("/.git")
      yield* machine.files.write("/work/a.txt", bytes("alpha\n"))
      const registry = yield* Tool.Service
      // A formatter that appends to its file: a machine write must not start it.
      const formatter = yield* Formatter.Service
      yield* formatter.transform((editor) =>
        editor.set({
          name: "append",
          extensions: [".txt"],
          enabled: Effect.succeed([
            process.execPath,
            "-e",
            "require('fs').appendFileSync(process.argv.at(-1), 'formatted\\n')",
            "$FILE",
          ]),
        }),
      )

      expect(yield* executeTool(registry, call("read", { path: "gpu:/work/a.txt" }))).toMatchObject({
        status: "completed",
        output: { type: "text", content: "alpha\n" },
      })
      expect(yield* executeTool(registry, call("read", { path: "gpu:/work" }))).toMatchObject({
        status: "completed",
        output: { type: "directory", entries: ["a.txt"] },
      })
      expect(
        yield* executeTool(registry, call("write", { path: "gpu:/work/new.txt", content: "created\n" })),
      ).toMatchObject({ status: "completed", output: "Created file successfully: gpu:/work/new.txt" })
      expect(
        yield* executeTool(registry, call("edit", { path: "gpu:/work/a.txt", oldString: "alpha", newString: "beta" })),
      ).toMatchObject({ status: "completed", output: "Edited gpu:/work/a.txt (1 replacement)" })
      expect(
        yield* executeTool(
          registry,
          call("patch", {
            patchText: "*** Begin Patch\n*** Update File: gpu:/work/a.txt\n@@\n-beta\n+gamma\n*** End Patch",
          }),
        ),
      ).toMatchObject({ status: "completed", metadata: { files: [{ file: "gpu:/work/a.txt" }] } })

      expect(text((yield* machine.files.read("/work/a.txt")).bytes)).toBe("gamma\n")
      expect(text((yield* machine.files.read("/work/new.txt")).bytes)).toBe("created\n")
      expect(tools.processes).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
      expect(worker.runs).toEqual([])

      const external = tools.assertions.filter((entry) => entry.action === "external_directory")
      expect(external[0]).toMatchObject({ resources: ["gpu:/work/*"], save: ["gpu:/work/*"] })
      const reads = tools.assertions.filter((entry) => entry.action === "read")
      expect(reads[0]?.resources).toEqual(["gpu:/work/a.txt"])
      expect(tools.assertions.some((entry) => entry.resources.includes("gpu:/work/a.txt"))).toBe(true)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reads a file under the machine's home and asks approval for its resolved path", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.write("/home/worker/notes.txt", bytes("home\n"))

      const access = yield* FileAccess.Service
      expect(`${(yield* access.locate("gpu:~")).absolute}`).toBe("/home/worker")
      expect(`${(yield* access.locate("gpu:~/a/../notes.txt")).absolute}`).toBe("/home/worker/notes.txt")
      expect(`${(yield* access.locate("gpu:~/../other")).absolute}`).toBe("/home/other")

      expect(yield* executeTool(yield* Tool.Service, call("read", { path: "gpu:~/notes.txt" }))).toMatchObject({
        status: "completed",
        output: { type: "text", content: "home\n" },
      })
      expect(tools.assertions.map((entry) => [entry.action, entry.resources, entry.save])).toEqual([
        ["external_directory", ["gpu:/home/worker/*"], ["gpu:/home/worker/*"]],
        ["read", ["gpu:/home/worker/notes.txt"], ["*"]],
      ])
      expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reads a recovered filename on the machine, not this server's disk", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      // The machine's own root, so a lost machine context would look on this server's disk instead.
      yield* machine.files.mkdir("/mwork")
      yield* machine.files.write("/mwork/a b.txt", bytes("machine\n"))

      const result = yield* executeTool(
        yield* Tool.Service,
        // A different space character names no file, so the read falls back to the one that only differs by it.
        call("read", { path: "gpu:/mwork/a\u00a0b.txt" }),
      )
      expect(result).toMatchObject({ status: "completed", output: { type: "text", content: "machine\n" } })

      const external = tools.assertions.filter((entry) => entry.action === "external_directory")
      expect(external.some((entry) => entry.resources.includes("gpu:/mwork/*"))).toBe(true)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("uses a rule for the machine's path, never one for the same path without the machine", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      yield* machine.files.write("/work/a.txt", bytes("alpha\n"))
      yield* executeTool(yield* Tool.Service, call("read", { path: "gpu:/work/a.txt" }))

      const read = tools.assertions.find((entry) => entry.action === "read")
      expect(read?.resources).toEqual(["gpu:/work/a.txt"])
      expect(read?.save).toEqual(["*"])

      const allow = (resource: string) => [{ action: "read" as const, resource, effect: "allow" as const }]
      expect(Permission.evaluate("read", "gpu:/work/a.txt", allow("/work/*")).effect).toBe("ask")
      expect(Permission.evaluate("read", "gpu:/work/a.txt", allow("gpu:/work/*")).effect).toBe("allow")
      const external = (resource: string) => [
        { action: "external_directory" as const, resource, effect: "allow" as const },
      ]
      expect(Permission.evaluate("external_directory", "gpu:/work/*", external("/work/*")).effect).toBe("ask")
      expect(Permission.evaluate("external_directory", "gpu:/work/*", external("gpu:/work/*")).effect).toBe("allow")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("runs a shell command on the machine in its working directory", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "nvidia-smi", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.runs[0].print("NVIDIA-SMI 550.54\n")
      yield* worker.runs[0].exit(0)

      expect(yield* Fiber.join(running)).toMatchObject({
        status: "completed",
        output: { exitCode: 0, output: "NVIDIA-SMI 550.54\n" },
      })
      expect(worker.runs[0].argv).toEqual(["sh", "-c", "nvidia-smi"])
      expect(worker.runs[0].cwd).toBe("/work")
      expect(worker.runs[0].env.OPENCODE_SESSION_ID).toBe(sessionID)
      expect(tools.assertions[0]).toMatchObject({ action: "external_directory", resources: ["gpu:/work/*"] })
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("runs a shell command in the machine's home", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/home/worker")
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "ls", workdir: "gpu:~" })),
        {
          startImmediately: true,
        },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.runs[0].exit(0)

      expect(yield* Fiber.join(running)).toMatchObject({ status: "completed" })
      expect(worker.runs[0].cwd).toBe("/home/worker")
      expect(tools.assertions[0]).toMatchObject({ action: "external_directory", resources: ["gpu:/home/worker/*"] })
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("resolves a directory a command names on the machine, never as another machine", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        // To `sh` this is the relative directory `/work/cpu:/secret`, not a machine named cpu.
        executeTool(registry, call("shell", { command: "cd cpu:/secret", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.runs[0].exit(0)

      expect(yield* Fiber.join(running)).toMatchObject({ status: "completed" })
      const external = tools.assertions.filter((entry) => entry.action === "external_directory")
      expect(external.some((entry) => entry.resources.includes("gpu:/work/cpu:/secret/*"))).toBe(true)
      expect(external.some((entry) => entry.resources.some((resource) => String(resource).startsWith("cpu:")))).toBe(
        false,
      )
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("resolves a machine-shaped directory a local command names as a local folder", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      // No machine named gpu exists: the flag is on, but this text came from a local working directory.
      const result = yield* executeTool(
        yield* Tool.Service,
        call("shell", { command: "cd gpu:/work", workdir: tmp.path }),
      )
      expect(result.status).toBe("completed")
      const external = tools.assertions.filter((entry) => entry.action === "external_directory")
      expect(external.some((entry) => entry.resources.some((resource) => String(resource).startsWith("gpu:")))).toBe(
        false,
      )
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("keeps a hook-moved working directory on the machine the command was asked for", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      // The moved path exists on gpu, so only its placement decides whether this runs.
      yield* machine.files.mkdir("/work/cpu:/secret")
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (invocation) =>
        Effect.sync(() => {
          invocation.cwd = "cpu:/secret"
        }),
      )
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "pwd", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.runs[0].exit(0)

      expect(yield* Fiber.join(running)).toMatchObject({ status: "completed" })
      expect(worker.runs[0].cwd).toBe("/work/cpu:/secret")
      const external = tools.assertions.filter((entry) => entry.action === "external_directory")
      expect(external.some((entry) => entry.resources.includes("gpu:/work/cpu:/secret/*"))).toBe(true)
      expect(external.some((entry) => entry.resources.some((resource) => String(resource).startsWith("cpu:")))).toBe(
        false,
      )
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("keeps a hook-moved working directory local when the command is local", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (invocation) =>
        Effect.sync(() => {
          invocation.cwd = "gpu:/work"
        }),
      )
      const result = yield* executeTool(yield* Tool.Service, call("shell", { command: "pwd", workdir: tmp.path }))
      // The moved path is a local folder that does not exist, not a machine named gpu.
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("Working directory does not exist")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

for (const [command, directory] of [
  ["cd ~", "gpu:/home/worker/*"],
  ["cd ~/src", "gpu:/home/worker/src/*"],
  // To `sh` a quoted or escaped tilde is a directory of that name, and a tilde before a quoted rest is still the home.
  ['cd "~/src"', "gpu:/work/~/src/*"],
  ["cd '~'", "gpu:/work/~/*"],
  ["cd \\~", "gpu:/work/~/*"],
  ['cd ~/"a b"', "gpu:/home/worker/a b/*"],
] as const)
  on.effect(`asks approval for the directory sh enters on the machine, never this server's home, for ${command}`, () =>
    withTempDir((tmp) => {
      const tools = fixture(tmp.path)
      return Effect.gen(function* () {
        const machines = yield* Machines.Service
        const { id, worker } = yield* connected(machines, "gpu")
        const machine = yield* machines.get(id)
        yield* machine.files.mkdir("/work")
        const registry = yield* Tool.Service
        const running = yield* Effect.forkChild(
          executeTool(registry, call("shell", { command, workdir: "gpu:/work" })),
          { startImmediately: true },
        )
        while (worker.runs.length === 0) yield* Effect.yieldNow
        yield* worker.runs[0].exit(0)

        expect(yield* Fiber.join(running)).toMatchObject({ status: "completed" })
        expect(worker.runs[0].cwd).toBe("/work")
        expect(tools.assertions[0]).toMatchObject({
          action: "external_directory",
          resources: ["gpu:/work/*", directory],
        })
      }).pipe(Effect.provide(graph(tools)))
    }),
  )

on.effect("refuses another user's home in a command on a machine", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const result = yield* executeTool(
        yield* Tool.Service,
        call("shell", { command: "cd ~other/src", workdir: "gpu:/work" }),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("A gpu path must be absolute or start with ~/, as in gpu:/work/file.")
      expect(tools.assertions.filter((entry) => entry.action === "external_directory")).toEqual([])
      expect(worker.runs).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

for (const [flag, flagged] of [
  ["off", off],
  ["on", on],
] as const)
  flagged.effect(`keeps expanding a home directory for a local command with the flag ${flag}`, () =>
    withTempDir((tmp) => {
      const tools = fixture(tmp.path)
      return Effect.gen(function* () {
        const result = yield* executeTool(yield* Tool.Service, call("shell", { command: "cd ~", workdir: tmp.path }))
        expect(result.status).toBe("completed")
        const external = tools.assertions.filter((entry) => entry.action === "external_directory")
        expect(external.some((entry) => entry.resources.includes(slash(path.join(Global.Path.home, "*"))))).toBe(true)

        // The parser expanded that one. A `~` that reaches the locator from a local directory, as a hook-moved
        // working directory does, is this server's home too.
        const access = yield* FileAccess.Service
        const home = yield* access.locate("~", {
          absolute: AbsolutePath.make(tmp.path),
          environment: { id: Environment.localID },
        })
        expect(home).toEqual({
          absolute: AbsolutePath.make(Global.Path.home),
          environment: { id: Environment.localID },
        })
      }).pipe(Effect.provide(graph(tools)))
    }),
  )

off.effect("resolves a directory a command names against its working directory", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "sub")))
      const result = yield* executeTool(
        yield* Tool.Service,
        call("shell", { command: "cd ..", workdir: path.join(tmp.path, "sub") }),
      )
      expect(result.status).toBe("completed")
      // `..` is the Location again, not a directory outside it.
      expect(tools.assertions.filter((entry) => entry.action === "external_directory")).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("refuses a machine it does not know with the list's message", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const result = yield* executeTool(yield* Tool.Service, call("read", { path: "gpu:/work/a.txt" }))
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain('No machine named "gpu".')
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("fails an offline machine with the driver's message and writes nothing", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      yield* machines.add("gpu")
      const result = yield* executeTool(
        yield* Tool.Service,
        call("write", { path: "gpu:/work/new.txt", content: "created\n" }),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("gpu is offline, command not sent")
      expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("fails a home path on an offline machine with the driver's message and writes nothing", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      yield* machines.add("gpu")
      // Locating makes no call to the machine, so this is its home being unknown, not a file call failing.
      const access = yield* FileAccess.Service
      expect((yield* access.locate("gpu:~/new.txt").pipe(Effect.flip)).cause).toBeInstanceOf(Machine.NotSent)
      const result = yield* executeTool(
        yield* Tool.Service,
        call("write", { path: "gpu:~/new.txt", content: "created\n" }),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("gpu is offline, command not sent")
      expect(tools.assertions).toEqual([])
      expect(yield* Effect.promise(() => fs.readdir(tmp.path))).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("refuses another user's home on a machine and says what a machine path may be", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      yield* connected(machines, "gpu")
      const result = yield* executeTool(yield* Tool.Service, call("read", { path: "gpu:~other/x" }))
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("A gpu path must be absolute or start with ~/, as in gpu:/work/file.")
      expect(tools.assertions).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("fails a shell on an offline machine with the driver's message", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      yield* machines.add("gpu")
      const result = yield* executeTool(
        yield* Tool.Service,
        call("shell", { command: "nvidia-smi", workdir: "gpu:/work" }),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("gpu is offline, command not sent")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

off.effect("leaves a local file failure's model-visible text as it was", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "blocker"), "not a folder"))
      const result = yield* executeTool(
        yield* Tool.Service,
        call("write", { path: "blocker/child.txt", content: "blocked\n" }),
      )
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("Unable to write blocker/child.txt")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("names a local folder that looks like a machine path apart from the machine's file", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const local = yield* access.resolve({ path: "./gpu:/work/a" })
      expect(local.resource).toBe("./gpu:/work/a")
      expect(local.externalDirectory).toBeUndefined()

      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      yield* machine.files.write("/work/a", bytes("machine\n"))
      expect(FileAccess.key(local)).not.toBe(FileAccess.key(yield* access.resolve({ path: "gpu:/work/a" })))

      const allow = [{ action: "read" as const, resource: "gpu:/work/a", effect: "allow" as const }]
      expect(Permission.evaluate("read", local.resource, allow).effect).toBe("ask")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reports a lost connection when a machine's worker stays away before the command starts", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      worker.drop("home", "started")
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "nvidia-smi", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.cut
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 seconds")

      const result = yield* Fiber.join(running)
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("Lost connection to gpu. The command may or may not have started.")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reports the machine's own sentence when its worker restarts mid-command", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "sleep 100", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.runs[0].print("partial\n")
      yield* worker.restart

      const result = yield* Fiber.join(running)
      expect(result.status).toBe("completed")
      const content = (result.content ?? []).map((part) => ("text" in part ? part.text : "")).join("\n")
      expect(content).toContain("gpu's worker restarted, the process was lost")
      expect(content).toContain("partial")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reports a process a machine forgot mid-command as no longer there", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      const running = yield* Effect.forkChild(
        executeTool(registry, call("shell", { command: "sleep 100", workdir: "gpu:/work" })),
        { startImmediately: true },
      )
      while (worker.runs.length === 0) yield* Effect.yieldNow
      yield* worker.cut
      worker.forget(worker.runs[0].id)
      yield* worker.restore

      const result = yield* Fiber.join(running)
      expect(result.status).toBe("completed")
      const content = (result.content ?? []).map((part) => ("text" in part ? part.text : "")).join("\n")
      expect(content).toContain("gpu's worker no longer has the process")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("locks a typed path and a resolved target to one file through a symlinked directory", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "real")))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "real", "a"), "one"))
      yield* Effect.promise(() => fs.symlink("real", path.join(tmp.path, "link")))
      const access = yield* FileAccess.Service
      const fileMutation = yield* FileMutation.Service
      // The resolved target keeps the symlinked text; the typed path names the real directory.
      const resolved = yield* access.resolve({ path: "link/a", kind: "file" })
      const typed = yield* access.locate("real/a")
      expect(FileAccess.key(resolved)).not.toBe(FileAccess.key(typed))

      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const finished = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(
        fileMutation.withLock([resolved])(
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        ),
        { startImmediately: true },
      )
      yield* Deferred.await(held)
      const second = yield* Effect.forkChild(fileMutation.withLock([typed])(Deferred.succeed(finished, undefined)), {
        startImmediately: true,
      })
      for (let turn = 0; turn < 100; turn++) yield* Effect.yieldNow
      expect(yield* Deferred.isDone(finished)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(yield* Deferred.isDone(finished)).toBe(true)
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("locks a machine file apart from a local file with the same path, and together with itself", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      yield* machine.files.write("/work/a", bytes("one"))
      const access = yield* FileAccess.Service
      const fileMutation = yield* FileMutation.Service
      const lock = yield* access.locate("gpu:/work/a")

      expect(FileAccess.key(lock)).toBe(FileAccess.key(yield* access.resolve({ path: "gpu:/work/a" })))
      expect(FileAccess.key(lock)).not.toBe(FileAccess.key(yield* access.locate("/work/a")))

      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const order: string[] = []
      const first = yield* Effect.forkChild(
        fileMutation.withLock([lock])(
          Effect.gen(function* () {
            yield* Deferred.succeed(held, undefined)
            yield* Deferred.await(release)
            order.push("machine")
          }),
        ),
        { startImmediately: true },
      )
      yield* Deferred.await(held)

      // A local lock with the same path is available while the machine file is held.
      yield* fileMutation.withLock([yield* access.locate("/work/a")])(Effect.sync(() => void order.push("local")))
      expect(order).toEqual(["local"])

      // A second lock on the same machine file waits.
      const second = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* fileMutation.withLock([lock])(Effect.sync(() => void order.push("second")))
        }),
        { startImmediately: true },
      )
      yield* Deferred.await(started)
      for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow
      expect(order).toEqual(["local"])

      // The edit tool takes the same machine lock: it cannot finish, or even ask for edit approval, while the file is held.
      const edited = yield* Deferred.make<void>()
      const edit = yield* Effect.forkChild(
        executeTool(
          yield* Tool.Service,
          call("edit", { path: "gpu:/work/a", oldString: "one", newString: "two" }),
        ).pipe(Effect.tap(() => Deferred.succeed(edited, undefined))),
        { startImmediately: true },
      )
      for (let turn = 0; turn < 1000; turn++) {
        if ((yield* Deferred.isDone(edited)) || tools.assertions.some((entry) => entry.action === "edit")) break
        yield* Effect.yieldNow
      }
      expect(yield* Deferred.isDone(edited)).toBe(false)
      expect(tools.assertions.some((entry) => entry.action === "edit")).toBe(false)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(yield* Fiber.join(edit)).toMatchObject({
        status: "completed",
        output: "Edited gpu:/work/a (1 replacement)",
      })
      expect(order).toEqual(["local", "machine", "second"])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("refuses search on a machine instead of searching this server's disk", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work")
      const registry = yield* Tool.Service
      for (const [name, input] of [
        ["grep", { pattern: "alpha", path: "gpu:/work" }],
        ["glob", { pattern: "*", path: "gpu:/work" }],
      ] as const) {
        const result = yield* executeTool(registry, call(name, input))
        expect(result.status).toBe("error")
        expect(result.error?.message).toBe("Search is not available on gpu yet.")
      }
    }).pipe(Effect.provide(graph(tools)))
  }),
)
