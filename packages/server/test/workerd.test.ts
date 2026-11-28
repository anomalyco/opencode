import { expect } from "bun:test"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment, makeFiles, makeMemoryDriver } from "@opencode/core/environment/index"
import { FileSystem } from "@opencode/core/filesystem"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Image } from "@opencode/core/image"
import { Identity } from "@opencode/core/machine/identity"
import { Project } from "@opencode/core/project"
import { Pty } from "@opencode/core/pty"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Snapshot } from "@opencode/core/snapshot"
import { Vcs } from "@opencode/core/vcs"
import { Workspace } from "@opencode/core/workspace"
import { Worktree } from "@opencode/core/worktree"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { bytesToBase64 } from "@opencode/util/base64"
import { Npm } from "@opencode/util/npm"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { location } from "../../core/test/fixture/location"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"

// Covers the profile's replacement graph composing and the database booting
// through the injected Durable Object storage.
it.live("boots the workerd profile over durable object storage", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(unauthorized.status).toBe(401)

    const status = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/info", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(status.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => status.json())
    expect(body).toMatchObject({ version: "workerd-test" })

    // alarm() runs cleanly as a no-op when no workspaces are pending suspension.
    yield* Effect.promise(() => handler.alarm())
  }),
)

it.live("answers 503 for filesystem and pty routes on a bare workerd location", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })
    const authorization = `Basic ${btoa("opencode:secret")}`
    const request = (method: string, path: string, body?: string, contentType = "application/json") =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { authorization, ...(body === undefined ? {} : { "content-type": contentType }) },
            body,
          }),
        ),
      )
    const expectUnavailable = (service: string, method: string, path: string, body?: string, contentType?: string) =>
      Effect.gen(function* () {
        const response = yield* request(method, path, body, contentType)
        expect(response.status).toBe(503)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          _tag: "ServiceUnavailableError",
          service,
        })
      })

    yield* expectUnavailable("filesystem", "GET", "/api/fs/list?location[directory]=/")
    yield* expectUnavailable("filesystem", "GET", "/api/fs/read/a.txt?location[directory]=/")
    yield* expectUnavailable("filesystem", "GET", "/api/fs/find?location[directory]=/&query=a")
    yield* expectUnavailable(
      "filesystem",
      "POST",
      "/api/experimental/fs/write?location[directory]=/&path=/out.txt",
      "unavailable",
      "application/octet-stream",
    )
    yield* expectUnavailable("pty", "POST", "/api/pty?location[directory]=/", "{}")
  }),
)

it.effect("serves the bundled models.dev snapshot unless fetching is turned back on", () =>
  Effect.sync(() => {
    const storage = makeDurableObjectStorage()
    expect(ServerWorkerd.serverOptions({ storage }).models).toEqual({ fetch: false })
    expect(ServerWorkerd.serverOptions({ storage, models: { fetch: true } }).models).toEqual({ fetch: true })
  }),
)

it.effect("fails Npm.add with a clear workerd error instead of running the installer", () =>
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    const error = yield* npm.add("some-package").pipe(Effect.flip)
    expect(error).toBeInstanceOf(Npm.InstallFailedError)
    expect(String(error.cause)).toContain("Npm.add is not supported in this runtime")
  }).pipe(
    Effect.provide(AppNodeBuilder.build(Npm.node, ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }))),
  ),
)

it.effect("marks the workerd environment non-local and omits rg", () =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    expect(environment.id).toBe(Environment.localID)
    expect(environment.local).toBe(false)
    expect(environment.rg).toBeUndefined()
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(Environment.node, [
        ...ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/") }))),
        ),
      ]),
    ),
  ),
)

it.effect("persists machine Identity in Durable Object KV storage without filesystem access", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    const layer = AppNodeBuilder.build(Identity.node, ServerWorkerd.replacements({ storage }))
    const first = yield* Effect.flatMap(Identity.Service, (id) => id.publicKey()).pipe(Effect.provide(layer))
    expect(first.length).toBe(32)

    const restarted = AppNodeBuilder.build(Identity.node, ServerWorkerd.replacements({ storage }))
    const second = yield* Effect.flatMap(Identity.Service, (id) => id.publicKey()).pipe(Effect.provide(restarted))
    expect(second).toEqual(first)
  }),
)

it.effect("closes workerd workspace connections immediately and suspends idle workspaces via DO storage alarm", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    const suspended: Workspace.ID[] = []
    const memory = makeMemoryDriver()
    const fakeDriver = WorkspaceDriver.make({
      create: (input) => Effect.succeed({ binding: { workspaceID: input.workspaceID } }),
      connect: () => Effect.succeed(memory),
      suspendForIdle: (input) => Effect.sync(() => void suspended.push(input.workspaceID)),
      destroy: () => Effect.void,
    })
    const layer = AppNodeBuilder.build(Workspace.node, [
      ...ServerWorkerd.replacements({ storage }),
      WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: fakeDriver })),
    ])

    const workspaceID = yield* Workspace.Service.use((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { host: "sandbox" } })
        yield* makeFiles(yield* workspace.connect(id)).mkdir("/workerd-workspace")
        expect(yield* workspace.connected(id)).toBe(false)
        return id
      }),
    ).pipe(Effect.provide(layer))

    expect(yield* Effect.promise(() => storage.getAlarm())).toBe(20 * 60 * 1000)

    // After eviction, a fresh instance's suspendIdle (driven by DO alarm()) suspends the workspace.
    yield* TestClock.adjust("20 minutes")
    const result = yield* Workspace.Service.use((workspace) => workspace.suspendIdle()).pipe(Effect.provide(layer))
    expect(result).toEqual([workspaceID])
    expect(suspended).toEqual([workspaceID])
  }),
)

it.effect(
  "routes workerd FileSystem and search through an attached remote workspace and fails cleanly on bare locations",
  () =>
    Effect.gen(function* () {
      const storage = makeDurableObjectStorage()
      const memory = makeMemoryDriver()
      const workspaceID = Workspace.ID.make("wrk_workerd_fs")
      const fakeRgSpawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: Stream.make(new TextEncoder().encode("src/app.ts\n")),
            stderr: Stream.empty,
            all: Stream.make(new TextEncoder().encode("src/app.ts\n")),
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      )
      const fakeDriver = WorkspaceDriver.make({
        create: (input) => Effect.succeed({ binding: { workspaceID: input.workspaceID } }),
        connect: () => Effect.succeed({ spawner: fakeRgSpawner, overrides: memory.overrides }),
        suspendForIdle: () => Effect.void,
        destroy: () => Effect.void,
      })

      const workspaceLayer = AppNodeBuilder.build(FileSystem.node, [
        ...ServerWorkerd.replacements({ storage }),
        WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: fakeDriver })),
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("/workspace"), workspaceID })),
          ),
        ),
      ])

      const setupLayer = AppNodeBuilder.build(Workspace.node, [
        ...ServerWorkerd.replacements({ storage }),
        WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: fakeDriver })),
      ])
      yield* Workspace.Service.use((ws) =>
        ws.attach({ id: workspaceID, provider: "fake", binding: { host: "sandbox" } }),
      ).pipe(Effect.provide(setupLayer))

      yield* FileSystem.Service.use((fs) =>
        Effect.gen(function* () {
          yield* fs.write({ path: "src/app.ts", data: new TextEncoder().encode("export const ok = true") })
          const read = yield* fs.read({ path: RelativePath.make("src/app.ts") })
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(read.stream()))).toBe("export const ok = true")
          const entries = yield* fs.list()
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("src/"), type: "directory" },
          ])
          const found = yield* fs.find({ query: "app" })
          expect(found.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("src/app.ts"), type: "file" },
          ])
        }),
      ).pipe(Effect.provide(workspaceLayer))

      // Bare workerd location (no workspace) reports a typed unavailable error without touching node:fs
      // across read, list, write, and find.
      const bareLayer = AppNodeBuilder.build(FileSystem.node, [
        ...ServerWorkerd.replacements({ storage }),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/") }))),
        ),
      ])
      const expectUnavailable = (effect: Effect.Effect<unknown, unknown, FileSystem.Service>) =>
        effect.pipe(
          Effect.provide(bareLayer),
          Effect.flip,
          Effect.map((error) => {
            expect(error).toMatchObject({
              _tag: "FileSystem.UnavailableError",
              message: expect.stringContaining("no execution plane"),
            })
          }),
        )

      yield* expectUnavailable(FileSystem.Service.use((fs) => fs.list()))
      yield* expectUnavailable(FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make("a.txt") })))
      yield* expectUnavailable(FileSystem.Service.use((fs) => fs.write({ path: "a.txt", data: new Uint8Array([1]) })))
      yield* expectUnavailable(FileSystem.Service.use((fs) => fs.find({ query: "a" })))
    }),
)

it.effect("degrades Snapshot, Vcs, and Worktree cleanly on workerd through Environment gating", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Snapshot.node, Vcs.node, Worktree.node]), [
      ...ServerWorkerd.replacements({ storage }),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/") }))),
      ),
    ])

    yield* Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      const tree = Snapshot.ID.make("0".repeat(40))
      expect(yield* snapshot.capture()).toBeUndefined()
      expect(yield* snapshot.files({ from: tree, to: tree })).toEqual([])
      expect(yield* snapshot.diff({ from: tree, to: tree })).toEqual([])
      yield* snapshot.restore({ files: new Map([[RelativePath.make("a.txt"), tree]]) })

      const vcs = yield* Vcs.Service
      expect(yield* vcs.info()).toEqual({ branch: {} })
      expect(yield* vcs.base()).toBeNull()
      expect(yield* vcs.branches()).toEqual([])
      expect(yield* vcs.status()).toEqual([])
      expect(yield* vcs.diff("working")).toEqual([])
      expect(yield* vcs.initialize("git").pipe(Effect.flip)).toMatchObject({ kind: "unsupported" })

      const db = (yield* Database.Service).db
      const projectID = Project.ID.make("workerd-project")
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/"), sandboxes: [], time_created: 1, time_updated: 1 })
        .run()
        .pipe(Effect.orDie)

      const worktrees = yield* Worktree.Service
      expect(yield* worktrees.list({ projectID })).toEqual([])
      expect(yield* worktrees.create({ projectID }).pipe(Effect.flip)).toBeInstanceOf(Worktree.OperationError)
    }).pipe(Effect.provide(layer))
  }),
)

it.effect("wires Pty.unsupportedLayer in ServerWorkerd.replacements", () =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const id = Pty.ID.make("pty_workerd")
    expect(yield* pty.list()).toEqual([])
    expect(yield* pty.get(id).pipe(Effect.flip)).toEqual(new Pty.NotFoundError({ ptyID: id }))
    expect(yield* pty.create({}).pipe(Effect.flip)).toMatchObject({
      _tag: "Pty.UnavailableError",
      message: "PTY sessions are not available in this runtime",
    })
  }).pipe(
    Effect.provide(AppNodeBuilder.build(Pty.node, ServerWorkerd.replacements({ storage: makeDurableObjectStorage() }))),
  ),
)

it.effect("replaces Image.Service when ServerWorkerd options.image is supplied", () =>
  Effect.gen(function* () {
    const input = new Uint8Array([1, 2, 3, 4])
    const resized = new Uint8Array([9, 8])
    const seen: ServerWorkerd.ImageResizerInput[] = []
    const storage = makeDurableObjectStorage()
    const layer = AppNodeBuilder.build(
      Image.node,
      ServerWorkerd.replacements({
        storage,
        image: async (request) => {
          seen.push(request)
          return { bytes: resized, mime: "image/jpeg" }
        },
      }),
    )

    const result = yield* Image.Service.use((image) =>
      Effect.gen(function* () {
        yield* image.transform((editor) => editor.configure({ maxWidth: 1_024 }))
        return yield* image.normalize("photo.png", {
          uri: "file:///photo.png",
          content: bytesToBase64(input),
          encoding: "base64",
          mime: "image/png",
        })
      }),
    ).pipe(Effect.provide(layer))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.bytes).toEqual(input)
    expect(seen[0]?.mime).toBe("image/png")
    expect(seen[0]?.limits.maxWidth).toBe(1_024)
    expect(result.mime).toBe("image/jpeg")
    expect(result.content).toBe(bytesToBase64(resized))

    // Omitting options.image leaves Image.node untouched.
    const withoutImage = ServerWorkerd.replacements({ storage })
    expect(withoutImage.length).toBe(
      ServerWorkerd.replacements({ storage, image: ({ bytes, mime }) => ({ bytes, mime }) }).length - 1,
    )
  }),
)
