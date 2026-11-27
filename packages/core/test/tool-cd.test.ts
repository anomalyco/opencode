import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environments } from "@opencode/core/environment/environments"
import { WorkspaceConnector } from "@opencode/core/environment/workspace-connector"
import { Environment, makeMemoryDriver } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Machines } from "@opencode/core/machine/machines"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCwd } from "@opencode/core/session/cwd"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Tool } from "@opencode/core/tool"
import { CdTool } from "@opencode/core/tool/plugin/cd"
import { execute } from "@opencode/core/tool/runtime"
import { Worktree } from "@opencode/core/worktree"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool as ToolSchema } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const makeContext = (sessionID: SessionSchema.ID) => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_cd"),
  id: ToolSchema.CallID.make("call_cd"),
  progress: () => Effect.void,
})

const makeSandboxDriver = (calls: string[], memory = makeMemoryDriver()) =>
  WorkspaceDriver.make({
    create: ({ workspaceID }) => {
      calls.push("create")
      return Effect.succeed({ binding: { workspaceID } })
    },
    connect: () => {
      calls.push("connect")
      return Effect.succeed(memory)
    },
    suspendForIdle: () => Effect.void,
    destroy: () => Effect.void,
  })

const buildLayer = (options: {
  readonly directory: AbsolutePath
  readonly dataDirectory?: string
  readonly workspaceID?: Workspace.ID
  readonly driver: WorkspaceDriver.Interface
  readonly machinesFlag?: boolean
  readonly assertions?: Permission.AssertInput[]
  readonly permissionBehavior?: "allow" | "block" | "correct"
  readonly worktrees?: readonly AbsolutePath[]
}) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Environment.node,
      Environments.node,
      FileAccess.node,
      Flag.node,
      Machines.node,
      Permission.node,
      Plugin.node,
      PluginHost.requirements,
      Session.node,
      Tool.node,
      Workspace.node,
    ]),
    [
      WorkspaceConnector.node.replace(Workspace.connectorNode),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: options.directory, workspaceID: options.workspaceID })),
        ),
      ),
      Global.node.replace(
        Global.layerWith({
          config: options.dataDirectory ?? options.directory,
          tmp: options.dataDirectory ?? options.directory,
        }),
      ),
      Flag.node.replace(Flag.testLayer([], { overrides: options.machinesFlag === false ? "-machines" : "machines" })),
      Permission.node.replace(
        Layer.mock(Permission.Service, {
          assert: (input) => {
            options.assertions?.push(input)
            if (options.permissionBehavior === "block" && input.action === "external_directory")
              return Effect.fail(
                new Permission.BlockedError({
                  permission: input.action,
                  resources: [...input.resources],
                  rules: [],
                }),
              )
            if (options.permissionBehavior === "correct" && input.action === "external_directory")
              return Effect.fail(new Permission.CorrectedError({ feedback: "Stay inside this repo." }))
            return Effect.void
          },
        }),
      ),
      ...(options.worktrees
        ? [
            Worktree.node.replace(
              Layer.mock(Worktree.Service, {
                list: () =>
                  Effect.succeed(
                    options.worktrees!.map((directory) => ({
                      directory,
                      branch: "feature",
                      name: path.basename(directory),
                      managed: true,
                    })),
                  ),
              }),
            ),
          ]
        : []),
      WorkspaceDriver.node.replace(
        Layer.succeed(
          WorkspaceDriver.RegistryService,
          WorkspaceDriver.RegistryService.of({
            get: (provider) =>
              provider === "fake"
                ? Effect.succeed(options.driver)
                : Effect.fail(new WorkspaceDriver.ProviderNotFound({ provider })),
          }),
        ),
      ),
    ],
  )

const seedSession = (directory: AbsolutePath, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, directory, slug: "cd-test", version: "test" })
      .run()
      .pipe(Effect.orDie)
  })

const registerCd = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, CdTool.Plugin.id)
  yield* CdTool.Plugin.effect(host)
  const tools = yield* Tool.Service
  return (yield* tools.list()).find((tool) => tool.name === "cd")
})

describe("CdTool", () => {
  it.live("stays unregistered when the machines flag is off", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const layer = buildLayer({
        directory: AbsolutePath.make(tmp.path),
        driver: makeSandboxDriver([]),
        machinesFlag: false,
      })

      yield* Effect.gen(function* () {
        expect(yield* registerCd).toBeUndefined()
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("switches cwd across local dirs, sandboxes, and resets to default on null", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sub = path.join(tmp.path, "sub")
      yield* Effect.promise(() => fs.mkdir(sub))
      const file = path.join(tmp.path, "note.txt")
      yield* Effect.promise(() => fs.writeFile(file, "hi"))

      const calls: string[] = []
      const memory = makeMemoryDriver()
      const dir = AbsolutePath.make(tmp.path)
      const sessionID = SessionSchema.ID.make("ses_cd_switch")
      const layer = buildLayer({ directory: dir, driver: makeSandboxDriver(calls, memory) })

      yield* Effect.gen(function* () {
        yield* seedSession(dir, sessionID)
        const cd = yield* registerCd
        if (!cd) throw new Error("expected cd tool")

        const sessions = yield* Session.Service
        const workspaces = yield* Workspace.Service

        // 1. Local subdirectory
        const localRes = yield* execute(cd, { path: "sub" }, makeContext(sessionID))
        expect(localRes.output).toEqual({ cwd: sub, environment: Environment.localID })
        expect(yield* sessions.cwd(sessionID)).toEqual({
          absolute: AbsolutePath.make(sub),
          environment: { id: Environment.localID },
        })

        // 2. Reject a file path cleanly
        const fileErr = yield* execute(cd, { path: "note.txt" }, makeContext(sessionID)).pipe(Effect.flip)
        expect(fileErr.message).toContain("not a directory")

        // 3. Switch to a cloud sandbox directory
        const wrkID = yield* workspaces.create({ provider: "fake" })
        yield* memory.overrides!.mkdir!("/workspace")
        const sandboxRes = yield* execute(cd, { path: `${wrkID}:/workspace` }, makeContext(sessionID))
        expect(sandboxRes.output).toEqual({ cwd: `${wrkID}:/workspace`, environment: Environment.ID.make(wrkID) })
        expect(yield* sessions.cwd(sessionID)).toEqual({
          absolute: AbsolutePath.make("/workspace"),
          environment: { id: Environment.ID.make(wrkID) },
        })
        expect(calls).toEqual(["create", "connect"])

        // 4. Reset to default with null (even if the current cwd points at a removed machine)
        yield* sessions.setCwd({
          sessionID,
          cwd: { absolute: AbsolutePath.make("/dead"), environment: { id: Environment.ID.make("ghost") } },
        })
        const resetRes = yield* execute(cd, { path: null }, makeContext(sessionID))
        expect(resetRes.output).toEqual({ cwd: null, environment: null })
        expect(yield* sessions.cwd(sessionID)).toBeUndefined()

        // 5. Escape a dead/removed machine cwd directly to a valid local directory
        const deadEnv = Environment.unavailable(
          Environment.ID.make("ghost"),
          new Machines.NotFound({ machine: Environment.ID.make("ghost") }),
        )
        const escaped = yield* execute(cd, { path: `local:${sub}` }, makeContext(sessionID)).pipe(
          Effect.provideService(Environment.CurrentWorkingDirectory, {
            absolute: AbsolutePath.make("/dead"),
            environment: deadEnv,
          }),
        )
        expect(escaped.output).toEqual({ cwd: sub, environment: Environment.localID })
        expect(yield* SessionCwd.read((yield* Database.Service).db, sessionID)).toEqual({
          absolute: AbsolutePath.make(sub),
          environment: { id: Environment.localID },
        })
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("enforces external_directory before probing or cold-waking a lazy sandbox and propagates feedback", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const outside = yield* tmpdirScoped()
      const calls: string[] = []
      const assertions: Permission.AssertInput[] = []
      const dir = AbsolutePath.make(tmp.path)
      const sessionID = SessionSchema.ID.make("ses_cd_perm")
      const blockedLayer = buildLayer({
        directory: dir,
        driver: makeSandboxDriver(calls),
        assertions,
        permissionBehavior: "block",
      })

      yield* Effect.gen(function* () {
        yield* seedSession(dir, sessionID)
        const cd = yield* registerCd
        if (!cd) throw new Error("expected cd tool")
        const sessions = yield* Session.Service
        const workspaces = yield* Workspace.Service

        // Denying an external local directory prevents cwd change.
        const localDenied = yield* execute(cd, { path: outside.path }, makeContext(sessionID)).pipe(Effect.flip)
        expect(localDenied._tag).toBe("Tool.Error")
        expect(yield* sessions.cwd(sessionID)).toBeUndefined()
        expect(assertions.some((item) => item.action === "external_directory")).toBe(true)

        // Denying a cold sandbox prevents cwd change AND never provisions/wakes the sandbox.
        const wrkID = yield* workspaces.create({ provider: "fake" })
        const wrkDenied = yield* execute(cd, { path: `${wrkID}:/workspace` }, makeContext(sessionID)).pipe(Effect.flip)
        expect(wrkDenied._tag).toBe("Tool.Error")
        expect(yield* sessions.cwd(sessionID)).toBeUndefined()
        expect(calls).toEqual([])
      }).pipe(Effect.provide(blockedLayer))

      // CorrectedError surfaces the user's feedback cleanly while keeping cwd unchanged.
      const correctedLayer = buildLayer({
        directory: dir,
        driver: makeSandboxDriver([]),
        permissionBehavior: "correct",
      })
      yield* Effect.gen(function* () {
        yield* seedSession(dir, sessionID)
        const cd = yield* registerCd
        if (!cd) throw new Error("expected cd tool")
        const corrected = yield* execute(cd, { path: outside.path }, makeContext(sessionID)).pipe(Effect.flip)
        expect(toSessionError(corrected)).toEqual({
          type: "permission.rejected",
          message: "Stay inside this repo.",
        })
        expect(yield* (yield* Session.Service).cwd(sessionID)).toBeUndefined()
      }).pipe(Effect.provide(correctedLayer))
    }),
  )

  it.live("exempts host-local project worktrees from external_directory, but not sandbox paths", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const worktreeDir = yield* tmpdirScoped()
      const assertions: Permission.AssertInput[] = []
      const dir = AbsolutePath.make(tmp.path)
      const sessionID = SessionSchema.ID.make("ses_cd_wt")
      const localLayer = buildLayer({
        directory: dir,
        driver: makeSandboxDriver([]),
        assertions,
        worktrees: [AbsolutePath.make(worktreeDir.path)],
      })

      yield* Effect.gen(function* () {
        yield* seedSession(dir, sessionID)
        const cd = yield* registerCd
        if (!cd) throw new Error("expected cd tool")
        const res = yield* execute(cd, { path: worktreeDir.path }, makeContext(sessionID))
        expect(res.output).toEqual({ cwd: worktreeDir.path, environment: Environment.localID })
        expect(assertions).toEqual([])
      }).pipe(Effect.provide(localLayer))

      // On a sandboxed workspace Location, a sandbox path matching a host worktree path must still prompt.
      const sandboxAssertions: Permission.AssertInput[] = []
      const memory = makeMemoryDriver()
      // A sandboxed Location resolves plain paths with the host's path rules (`D:\outside-wt` on Windows), so create
      // the directory where that resolution lands for the memory driver to find it.
      const sandboxWorktreePath = AbsolutePath.make(path.resolve("/outside-wt"))
      yield* memory.overrides!.mkdir!(sandboxWorktreePath)
      const wrkID = Workspace.ID.make("wrk_wt_test")
      const sandboxLayer = buildLayer({
        directory: AbsolutePath.make("/workspace"),
        dataDirectory: tmp.path,
        workspaceID: wrkID,
        driver: makeSandboxDriver([], memory),
        assertions: sandboxAssertions,
        worktrees: [sandboxWorktreePath],
      })

      yield* Effect.gen(function* () {
        yield* seedSession(AbsolutePath.make("/workspace"), sessionID)
        const cd = yield* registerCd
        if (!cd) throw new Error("expected cd tool")
        const workspaces = yield* Workspace.Service
        yield* workspaces.create({ id: wrkID, provider: "fake" })
        yield* execute(cd, { path: sandboxWorktreePath }, makeContext(sessionID))
        expect(sandboxAssertions.some((item) => item.action === "external_directory")).toBe(true)
      }).pipe(Effect.provide(sandboxLayer))
    }),
  )
})
