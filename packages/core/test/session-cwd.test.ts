import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Fiber, Layer } from "effect"
import type { ChildProcess } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Environments } from "@opencode/core/environment/environments"
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
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Machines } from "@opencode/core/machine/machines"
import { Permission } from "@opencode/core/permission"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Ripgrep } from "@opencode/core/ripgrep"
import { Sandbox } from "@opencode/core/sandbox"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCwd } from "@opencode/core/session/cwd"
import { SessionExecution } from "@opencode/core/session/execution"
import { fromRow } from "@opencode/core/session/info"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempGlobalLayer } from "./fixture/global"
import { makeWorker } from "./fixture/machine-worker"
import { promptLocationNode } from "./fixture/prompt-location"
import { disabledPersistentPtyLayer } from "./fixture/persistent-pty"
import { location } from "./fixture/location"
import { globalProjectNode } from "./lib/project"
import { permissionLayer } from "./lib/permission"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { withTempDir } from "./fixture/tmpdir"

// Durable state: create, set, inherit and reload, with no filesystem or machine behind it.
const state = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      InstructionEntry.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const local = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const gpu = Environment.ID.make("gpu")
const gpuCwd = { absolute: AbsolutePath.make("/work/app"), environment: { id: gpu } }
const otherGpuCwd = { absolute: AbsolutePath.make("/work/other"), environment: { id: gpu } }

describe("Session cwd", () => {
  state.effect("creates a session with a cwd and leaves Session.Info metadata clean", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location: local, cwd: gpuCwd })

      expect(yield* sessions.cwd(created.id)).toEqual(gpuCwd)
      expect(created.metadata).toBeUndefined()
      expect((yield* sessions.get(created.id)).metadata).toBeUndefined()
    }),
  )

  state.effect("sets and clears a session's cwd", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location: local })
      expect(yield* sessions.cwd(created.id)).toBeUndefined()

      yield* sessions.setCwd({ sessionID: created.id, cwd: gpuCwd })
      expect(yield* sessions.cwd(created.id)).toEqual(gpuCwd)

      yield* sessions.setCwd({ sessionID: created.id, cwd: undefined })
      expect(yield* sessions.cwd(created.id)).toBeUndefined()
    }),
  )

  state.effect("lets a child inherit its parent's cwd, and overrides it when given one", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ location: local, cwd: gpuCwd })
      const inheriting = yield* sessions.create({ parentID: parent.id })
      const overriding = yield* sessions.create({ parentID: parent.id, cwd: otherGpuCwd })

      expect(yield* sessions.cwd(inheriting.id)).toEqual(gpuCwd)
      expect(yield* sessions.cwd(overriding.id)).toEqual(otherGpuCwd)
      // Inheritance is a fact at creation; the parent does not remain a later source of truth.
      yield* sessions.setCwd({ sessionID: parent.id, cwd: undefined })
      expect(yield* sessions.cwd(inheriting.id)).toEqual(gpuCwd)
    }),
  )

  state.effect("keeps experimental cwd isolated from caller metadata updates", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ location: local, cwd: gpuCwd, metadata: { source: "test" } })
      expect(yield* sessions.cwd(created.id)).toEqual(gpuCwd)
      expect(created.metadata).toEqual({ source: "test" })

      yield* sessions.setMetadata({
        sessionID: created.id,
        metadata: { source: "updated", $opencode_experimental_cwd: otherGpuCwd },
      })
      const afterMeta = yield* sessions.get(created.id)
      expect(yield* sessions.cwd(created.id)).toEqual(gpuCwd)
      expect(afterMeta.metadata).toEqual({ source: "updated" })

      yield* sessions.setCwd({ sessionID: created.id, cwd: undefined })
      const cleared = yield* sessions.get(created.id)
      expect(yield* sessions.cwd(created.id)).toBeUndefined()
      expect(cleared.metadata).toEqual({ source: "updated" })
    }),
  )
})

const sessionID = Session.ID.make("ses_session_cwd_test")

const toolPlugins = makeLocationNode({
  name: "test/session-cwd-tools",
  layer: Layer.effectDiscard(
    Effect.all(
      [registerToolPlugin(ReadTool.Plugin), registerToolPlugin(WriteTool.Plugin), registerToolPlugin(ShellTool.Plugin)],
      { discard: true },
    ),
  ),
  deps: [
    Agent.node,
    Bus.node,
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
    Sandbox.node,
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

const graph = (fixture: Fixture, realPermissions = false) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Agent.node,
      Bus.node,
      Database.node,
      Permission.node,
      Tool.node,
      toolPlugins,
      Environment.node,
      Environments.node,
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
      ...(realPermissions
        ? []
        : [
            Permission.node.replace(
              permissionLayer({
                assert: (input) => Effect.sync(() => void fixture.assertions.push(input)),
              }),
            ),
          ]),
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
const external = (items: Permission.AssertInput[]) => items.filter((item) => item.action === "external_directory")

const withSessionRow = (
  directory: string,
  cwd?: { readonly absolute: AbsolutePath; readonly environment: { id: Environment.ID } },
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory,
        metadata: SessionCwd.writeStored(undefined, cwd),
        slug: "test",
        version: "test",
        agent: toolIdentity.agent,
      })
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => editor.update(toolIdentity.agent, () => {}))
    // The row as the runner loads it, so projection of the cwd column is part of the test.
    const row = yield* database.db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    return fromRow(row!)
  })

/** What the runner binds to a step: the cwd's place, or nothing when the Session has none or machines are off. */
const currentCwd = (session: Session.Info) => SessionCwd.current(session.id)

const on = testEffect(Layer.succeed(Flag.Overrides, "machines"))
const off = testEffect(Layer.succeed(Flag.Overrides, "-machines"))

on.live("resolves bare reads and writes inside a paired machine's cwd", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const session = yield* withSessionRow(tmp.path, gpuCwd)
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work/app/src")
      yield* machine.files.write("/work/app/src/a.txt", bytes("before\n"))
      const registry = yield* Tool.Service
      const cwd = yield* currentCwd(session)
      expect(cwd).toMatchObject({ absolute: "/work/app", environment: { id: "gpu" } })
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(Environment.CurrentWorkingDirectory, cwd))

      expect(yield* run(executeTool(registry, call("read", { path: "src/a.txt" })))).toMatchObject({
        status: "completed",
        output: { type: "text", content: "before\n" },
      })
      expect(yield* run(executeTool(registry, call("write", { path: "out.txt", content: "after\n" })))).toMatchObject({
        status: "completed",
      })
      expect(text((yield* machine.files.read("/work/app/out.txt")).bytes)).toBe("after\n")
      expect(external(tools.assertions)).toEqual([])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.live("runs a bare command on the machine cwd, and an explicit workdir overrides it", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const session = yield* withSessionRow(tmp.path, gpuCwd)
      const machines = yield* Machines.Service
      const { id, worker } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work/app")
      yield* machine.files.mkdir("/work/elsewhere")
      const registry = yield* Tool.Service
      const cwd = yield* currentCwd(session)
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(Environment.CurrentWorkingDirectory, cwd))

      const bare = yield* Effect.forkChild(run(executeTool(registry, call("shell", { command: "pwd" }))), {
        startImmediately: true,
      })
      while (worker.runs.length === 0) yield* Effect.yieldNow
      expect(worker.runs[0].cwd).toBe("/work/app")
      yield* worker.runs[0].print("/work/app\n")
      yield* worker.runs[0].exit(0)
      expect(yield* Fiber.join(bare)).toMatchObject({ status: "completed", output: { exitCode: 0 } })

      const moved = yield* Effect.forkChild(
        run(executeTool(registry, call("shell", { command: "pwd", workdir: "gpu:/work/elsewhere" }))),
        { startImmediately: true },
      )
      while (worker.runs.length === 1) yield* Effect.yieldNow
      expect(worker.runs[1].cwd).toBe("/work/elsewhere")
      yield* worker.runs[1].print("/work/elsewhere\n")
      yield* worker.runs[1].exit(0)
      expect(yield* Fiber.join(moved)).toMatchObject({ status: "completed", output: { exitCode: 0 } })
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.live("asks for external_directory outside the machine cwd, not inside it", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const session = yield* withSessionRow(tmp.path, gpuCwd)
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work/app")
      yield* machine.files.mkdir("/work/other")
      yield* machine.files.write("/work/app/inside.txt", bytes("inside\n"))
      yield* machine.files.write("/work/other/outside.txt", bytes("outside\n"))
      const registry = yield* Tool.Service
      const cwd = yield* currentCwd(session)
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(Environment.CurrentWorkingDirectory, cwd))

      expect(yield* run(executeTool(registry, call("read", { path: "inside.txt" })))).toMatchObject({
        status: "completed",
      })
      expect(external(tools.assertions)).toEqual([])

      expect(yield* run(executeTool(registry, call("read", { path: "gpu:/work/other/outside.txt" })))).toMatchObject({
        status: "completed",
      })
      expect(external(tools.assertions)).toEqual([
        expect.objectContaining({
          action: "external_directory",
          resources: ["gpu:/work/other/*"],
        }),
      ])
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.effect("reads what someone typed as a cwd, refusing a missing directory or an unknown machine", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      yield* (yield* machines.get(id)).files.mkdir("/work/app")
      const target = yield* SessionCwd.locate(tmp.path)
      expect(target).toEqual({ absolute: AbsolutePath.make(tmp.path), environment: { id: Environment.localID } })
      expect(yield* SessionCwd.locate("gpu:/work/app")).toEqual(gpuCwd)
      expect(
        yield* SessionCwd.locate(`${tmp.path}/missing`).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.CwdError")
      expect(
        yield* SessionCwd.locate("nowhere:/work").pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Environment.Failed")
    }).pipe(Effect.provide(graph(tools)))
  }),
)

off.live("ignores a session cwd with the machines flag off, leaving bare paths local", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const session = yield* withSessionRow(tmp.path, gpuCwd)
      const machines = yield* Machines.Service
      const { id } = yield* connected(machines, "gpu")
      const machine = yield* machines.get(id)
      yield* machine.files.mkdir("/work/app")
      yield* machine.files.write("/work/app/local-only.txt", bytes("remote\n"))
      const registry = yield* Tool.Service

      expect(yield* currentCwd(session)).toBeUndefined()
      // The row still records the cwd; only its use is off.
      expect(yield* SessionCwd.read((yield* Database.Service).db, session.id)).toEqual(gpuCwd)
      expect((yield* executeTool(registry, call("read", { path: "local-only.txt" }))).status).toBe("error")
      expect(yield* machine.files.read("/work/app/local-only.txt").pipe(Effect.map((file) => text(file.bytes)))).toBe(
        "remote\n",
      )
    }).pipe(Effect.provide(graph(tools)))
  }),
)

on.live("fails loudly instead of falling back to local when a session's cwd machine was removed", () =>
  withTempDir((tmp) => {
    const tools = fixture(tmp.path)
    return Effect.gen(function* () {
      const session = yield* withSessionRow(tmp.path, gpuCwd)
      const resolved = yield* currentCwd(session)
      expect(resolved).toBeDefined()
      expect(resolved?.environment.id).toBe(gpuCwd.environment.id)
      const err = yield* resolved!.environment.files.read("/work/app/file.txt").pipe(Effect.flip)
      expect(err).toBeInstanceOf(Environment.Failed)
      if (err instanceof Environment.Failed) expect(err.cause).toBeInstanceOf(Machines.NotFound)
    }).pipe(Effect.provide(graph(tools)))
  }),
)
