import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Environments } from "@opencode/core/environment/environments"
import { Environment, makeMemoryDriver } from "@opencode/core/environment/index"
import { WorkspaceConnector } from "@opencode/core/environment/workspace-connector"
import { EnvironmentPath } from "@opencode/core/environment/path"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Location } from "@opencode/core/location"
import { Machines } from "@opencode/core/machine/machines"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionCwd } from "@opencode/core/session/cwd"
import { SessionCwdInstructions } from "@opencode/core/session/cwd-instructions"
import { InstructionState } from "@opencode/core/session/instruction-state"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)

describe("EnvironmentPath", () => {
  const cases: ReadonlyArray<readonly [string, { environment: string; path: string } | undefined]> = [
    ["local:/tmp/out.txt", { environment: "local", path: "/tmp/out.txt" }],
    ["local:~/notes.md", { environment: "local", path: "~/notes.md" }],
    ["wrk_01JXYZ:/workspace/app.ts", { environment: "wrk_01JXYZ", path: "/workspace/app.ts" }],
    ["wrk_:/x", undefined],
    ["local:relative", undefined],
  ]

  for (const [input, expected] of cases) {
    test(`parse ${JSON.stringify(input)}`, () => {
      const parsed = EnvironmentPath.parse(input)
      expect(parsed && { environment: `${parsed.environment}`, path: parsed.path }).toEqual(expected)
    })
  }

  test("local() escapes environment-shaped paths", () => {
    expect(EnvironmentPath.local("local:/tmp")).toBe("./local:/tmp")
    expect(EnvironmentPath.local("wrk_1:/app")).toBe("./wrk_1:/app")
    expect(EnvironmentPath.local("gpu:/work")).toBe("./gpu:/work")
    expect(EnvironmentPath.local("src/index.ts")).toBe("src/index.ts")
  })
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
  readonly denyExternal?: boolean
}) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Environment.node,
      Environments.node,
      FileAccess.node,
      Machines.node,
      Permission.node,
      SessionCwdInstructions.node,
      Workspace.node,
    ]),
    [
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
      InstructionDiscovery.node.replace(
        Layer.mock(InstructionDiscovery.Service, { project: true, global: true, claude: true }),
      ),
      ...(options.denyExternal
        ? [
            Permission.node.replace(
              Layer.mock(Permission.Service, {
                assert: (input) =>
                  Effect.fail(
                    new Permission.BlockedError({
                      permission: input.action,
                      resources: [...input.resources],
                      rules: [],
                    }),
                  ),
              }),
            ),
          ]
        : []),
      WorkspaceConnector.node.replace(Workspace.connectorNode),
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

const it = testEffect(Layer.empty)

describe("Environments", () => {
  it.live("resolves local to the server host and fails loudly for removed machines", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const layer = buildLayer({ directory: AbsolutePath.make(tmp.path), driver: makeSandboxDriver([]) })

      yield* Effect.gen(function* () {
        const environments = yield* Environments.Service
        const local = yield* environments.get(Environment.localID)
        expect(local.id).toBe(Environment.localID)
        expect(local.local).toBe(true)

        const removedID = Environment.ID.make("ghost")
        const removed = yield* environments.get(removedID)
        const removedRead = yield* removed.files.read("/x").pipe(Effect.flip)
        expect(removedRead).toBeInstanceOf(Environment.Failed)
        expect(removedRead.cause).toBeInstanceOf(Machines.NotFound)
        expect(yield* environments.lookup(removedID).pipe(Effect.flip)).toBeInstanceOf(Machines.NotFound)
        expect(toSessionError(new Tool.Error({ message: "Read failed", error: removedRead }))).toMatchObject({
          type: "tool.execution",
          message: 'No machine named "ghost".',
        })
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("fails lookup immediately for missing workspaces without provisioning", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const layer = buildLayer({ directory: AbsolutePath.make(tmp.path), driver: makeSandboxDriver(calls) })

      yield* Effect.gen(function* () {
        const environments = yield* Environments.Service
        const missingErr = yield* environments.lookup(Environment.ID.make("wrk_missing")).pipe(Effect.flip)
        expect(missingErr).toBeInstanceOf(Workspace.NotFound)
        expect(
          toSessionError(
            new Tool.Error({
              message: "Read failed",
              error: new Environment.Failed({ path: "/workspace", cause: missingErr }),
            }),
          ),
        ).toMatchObject({
          type: "tool.execution",
          message: 'No workspace named "wrk_missing".',
        })
        expect(calls).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("keeps a lazy workspace cold until first file operation and never widens cold approval rules", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const layer = buildLayer({ directory: AbsolutePath.make(tmp.path), driver: makeSandboxDriver(calls) })

      yield* Effect.gen(function* () {
        const environments = yield* Environments.Service
        const workspaces = yield* Workspace.Service
        const access = yield* FileAccess.Service

        const wrkID = yield* workspaces.create({ provider: "fake" })
        const wrkEnvID = Environment.ID.make(wrkID)
        expect(yield* environments.ready(wrkEnvID)).toBe(false)
        const sandbox = yield* environments.get(wrkEnvID)
        expect(calls).toEqual([])

        // Unknown-kind cold resolution narrows to the exact path instead of widening to parent (e.g. wrk_...:/*).
        const coldUnknown = yield* access.resolve({ path: `${wrkID}:/workspace` })
        expect(coldUnknown.externalDirectory).toMatchObject({
          action: "external_directory",
          resource: `${wrkID}:/workspace`,
          save: `${wrkID}:/workspace`,
        })
        expect(calls).toEqual([])

        // Explicit file kind uses the file's directory glob without waking the sandbox.
        const target = yield* access.resolve({ path: `${wrkID}:/workspace/hello.txt`, kind: "file" })
        expect(target.environment.id).toBe(wrkEnvID)
        expect(target.resource).toBe(`${wrkID}:/workspace/hello.txt`)
        expect(target.externalDirectory).toMatchObject({
          action: "external_directory",
          resource: `${wrkID}:/workspace/*`,
        })
        expect(calls).toEqual([])

        // First file write wakes and provisions the sandbox.
        yield* target.environment.files.mkdir("/workspace")
        yield* target.environment.files.write("/workspace/hello.txt", bytes("from sandbox"))
        expect(calls).toEqual(["create", "connect"])
        expect(yield* environments.ready(wrkEnvID)).toBe(true)
        expect(text((yield* sandbox.files.read("/workspace/hello.txt")).bytes)).toBe("from sandbox")

        // Once warm, unknown-kind resolution detects directories cleanly.
        const warmDir = yield* access.resolve({ path: `${wrkID}:/workspace` })
        expect(warmDir.externalDirectory).toMatchObject({
          action: "external_directory",
          resource: `${wrkID}:/workspace/*`,
        })
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("routes explicit local:/ paths back to the host from a foreign cwd and refuses non-rooted prefixes", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const layer = buildLayer({ directory: AbsolutePath.make(tmp.path), driver: makeSandboxDriver([]) })

      yield* Effect.gen(function* () {
        const environments = yield* Environments.Service
        const workspaces = yield* Workspace.Service
        const access = yield* FileAccess.Service
        const wrkID = yield* workspaces.create({ provider: "fake" })
        const sandbox = yield* environments.get(Environment.ID.make(wrkID))

        const localTarget = yield* access.resolve({ path: `local:${tmp.path}/spill.txt`, kind: "file" }).pipe(
          Effect.provideService(Environment.CurrentWorkingDirectory, {
            absolute: AbsolutePath.make("/workspace"),
            environment: sandbox,
          }),
        )
        expect(localTarget.environment.id).toBe(Environment.localID)
        expect(`${localTarget.absolute}`).toBe(path.join(tmp.path, "spill.txt"))

        for (const bad of [`${wrkID}:~/notes`, `${wrkID}:relative`, "local:relative"]) {
          const err = yield* access.locate(bad).pipe(Effect.flip)
          expect(err.cause).toBeInstanceOf(EnvironmentPath.NotAbsolute)
        }
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("does not provision a cold sandbox when authorizeRead is denied", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const layer = buildLayer({
        directory: AbsolutePath.make(tmp.path),
        driver: makeSandboxDriver(calls),
        denyExternal: true,
      })

      yield* Effect.gen(function* () {
        const workspaces = yield* Workspace.Service
        const access = yield* FileAccess.Service
        const wrkID = yield* workspaces.create({ provider: "fake" })

        const denied = yield* access
          .authorizeRead(`${wrkID}:/workspace/secret.txt`, {
            sessionID: SessionSchema.ID.make("ses_deny"),
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.make("msg_1"),
            id: Tool.CallID.make("call_1"),
          })
          .pipe(Effect.flip)
        expect(denied._tag).toBe("Permission.BlockedError")
        expect(calls).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("confines a sandboxed workspace Location so local:/ cannot escape to the host", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const wrkID = Workspace.ID.make("wrk_confined")
      const layer = buildLayer({
        directory: AbsolutePath.make("/workspace"),
        dataDirectory: tmp.path,
        workspaceID: wrkID,
        driver: makeSandboxDriver(calls),
      })

      yield* Effect.gen(function* () {
        const access = yield* FileAccess.Service
        for (const attempt of ["local:/etc/passwd", "local:~/secret", `${wrkID}:~/secret`]) {
          const target = yield* access.resolve({ path: attempt, kind: "file" })
          // Stays inside the sandbox environment instead of jumping to the server host.
          expect(target.environment.id).toBe(Environment.ID.make(wrkID))
        }
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("treats local:/ and wrk_...:/ as plain paths when the machines flag is off", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const layer = buildLayer({
        directory: AbsolutePath.make(tmp.path),
        driver: makeSandboxDriver(calls),
        machinesFlag: false,
      })

      yield* Effect.gen(function* () {
        const access = yield* FileAccess.Service
        const localPrefixed = yield* access.resolve({ path: "local:/x", kind: "file" })
        expect(localPrefixed.environment.id).toBe(Environment.localID)
        expect(`${localPrefixed.absolute}`).toBe(path.join(tmp.path, "local:/x"))

        const wrkPrefixed = yield* access.resolve({ path: "wrk_other:/x", kind: "file" })
        expect(wrkPrefixed.environment.id).toBe(Environment.localID)
        expect(`${wrkPrefixed.absolute}`).toBe(path.join(tmp.path, "wrk_other:/x"))
        expect(calls).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("skips AGENTS.md probe on a cold lazy sandbox and loads it once connected", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const calls: string[] = []
      const layer = buildLayer({ directory: AbsolutePath.make(tmp.path), driver: makeSandboxDriver(calls) })

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const environments = yield* Environments.Service
        const workspaces = yield* Workspace.Service
        const cwdInstructions = yield* SessionCwdInstructions.Service

        const dir = AbsolutePath.make(tmp.path)
        const sessionID = SessionSchema.ID.make("ses_lazy_sandbox_inst")
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: dir, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({ id: sessionID, project_id: Project.ID.global, directory: dir, slug: "lazy", version: "test" })
          .run()
          .pipe(Effect.orDie)

        const wrkID = yield* workspaces.create({ provider: "fake" })
        const wrkEnvID = Environment.ID.make(wrkID)
        const sandbox = yield* environments.get(wrkEnvID)
        const cwd: SessionCwd.Resolved = { absolute: AbsolutePath.make("/workspace"), environment: sandbox }

        // Step 1: sandbox is cold -> instruction read returns removed without waking or provisioning.
        const coldList = yield* cwdInstructions.load(cwd, sessionID)
        const coldObs = yield* InstructionState.observe(db, coldList, sessionID)
        expect(coldObs.current["core/cwd-instructions"]).toBeUndefined()
        expect(calls).toEqual([])

        // First tool wakes the sandbox and writes AGENTS.md.
        yield* sandbox.files.mkdir("/workspace")
        yield* sandbox.files.write("/workspace/AGENTS.md", bytes("Sandbox rules"))
        expect(calls).toEqual(["create", "connect"])

        // Step 2: sandbox is now ready -> AGENTS.md loads automatically.
        const warmList = yield* cwdInstructions.load(cwd, sessionID)
        const warmObs = yield* InstructionState.observe(db, warmList, sessionID)
        expect(warmObs.current["core/cwd-instructions"]).toBeDefined()
        const rendered = yield* readInitial(warmList)
        expect(rendered.text).toContain(`Instructions from: ${wrkID}:/workspace/AGENTS.md\nSandbox rules`)
      }).pipe(Effect.provide(layer))
    }),
  )
})
