import { afterEach, describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { HttpClientResponse } from "effect/unstable/http"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Session } from "@/session/session"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { resetDatabase } from "../fixture/db"
import { TestInstance, disposeAllInstances, provideInstanceEffect } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

// OPENCODE_NEW_SESSION_WORKSPACE: every new top-level session is bound to a
// fresh workspace of the given adapter type (per-tab CoW overlay isolation,
// fork feature). Children/subagents and explicit workspaceID payloads must
// be untouched; a missing adapter degrades to a trunk session.

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalDefaultWorkspace = process.env.OPENCODE_NEW_SESSION_WORKSPACE

// noop bootstrap (same trick as httpapi-session.test.ts): the real bootstrap
// starts LSP/config fibers that would hang the test scope on finalization
const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function overlayAdapter(base: string) {
  const state = { created: 0, removed: 0, directories: [] as string[] }
  const adapter: WorkspaceAdapter = {
    name: "Overlay Test",
    description: "Fresh CoW overlay per session",
    configure(info) {
      const directory = path.join(base, `overlay-${state.created + 1}`)
      state.directories.push(directory)
      return { ...info, name: "overlay-test", directory }
    },
    async create() {
      state.created++
    },
    async remove() {
      state.removed++
    },
    target(info) {
      return { type: "local" as const, directory: info.directory ?? state.directories[0] }
    },
  }
  return { adapter, state }
}

function createSession(directory: string, body?: Record<string, unknown>) {
  return request(SessionPaths.create, {
    method: "POST",
    headers: { "x-opencode-directory": directory, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).pipe(Effect.flatMap(json<Session.Info>))
}

function restoreDefaultWorkspaceEnv() {
  if (originalDefaultWorkspace === undefined) delete process.env.OPENCODE_NEW_SESSION_WORKSPACE
  else process.env.OPENCODE_NEW_SESSION_WORKSPACE = originalDefaultWorkspace
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  restoreDefaultWorkspaceEnv()
  await disposeAllInstances()
  await resetDatabase()
})

describe("OPENCODE_NEW_SESSION_WORKSPACE", () => {
  it.instance(
    "unset flag keeps trunk session behavior",
    () =>
      Effect.gen(function* () {
        delete process.env.OPENCODE_NEW_SESSION_WORKSPACE
        const test = yield* TestInstance

        const session = yield* createSession(test.directory)
        expect(session.directory).toBe(test.directory)
        expect(session.workspaceID).toBeUndefined()
        expect(session.parentID).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "binds a new top-level session to a fresh workspace",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const test = yield* TestInstance
        const project = yield* Project.use.fromDirectory(test.directory)
        const { adapter, state } = overlayAdapter(path.join(test.directory, ".overlays"))
        registerAdapter(project.project.id, "overlay-test", adapter)

        const session = yield* createSession(test.directory)

        // the session lives in the adapter's directory and carries the workspace id
        expect(session.directory).toBe(state.directories[0])
        expect(session.directory).not.toBe(test.directory)
        expect(session.workspaceID).toBeDefined()
        expect(state.created).toBe(1)

        // the workspace row exists and points at the same directory
        const workspaces = yield* Workspace.use.list(project.project)
        expect(workspaces).toMatchObject([{ type: "overlay-test", directory: state.directories[0] }])
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "gives parallel sessions distinct overlays",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const test = yield* TestInstance
        const project = yield* Project.use.fromDirectory(test.directory)
        const { adapter, state } = overlayAdapter(path.join(test.directory, ".overlays"))
        registerAdapter(project.project.id, "overlay-test", adapter)

        const [first, second] = yield* Effect.all([
          createSession(test.directory),
          createSession(test.directory),
        ])

        // one fresh workspace per session — never shared
        expect(state.created).toBe(2)
        expect(first.workspaceID).toBeDefined()
        expect(second.workspaceID).toBeDefined()
        expect(first.workspaceID).not.toBe(second.workspaceID)
        expect(first.directory).not.toBe(second.directory)
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "leaves parented (subagent) creates untouched",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const test = yield* TestInstance
        const project = yield* Project.use.fromDirectory(test.directory)
        const { adapter, state } = overlayAdapter(path.join(test.directory, ".overlays"))
        registerAdapter(project.project.id, "overlay-test", adapter)

        const parent = yield* createSession(test.directory)
        expect(state.created).toBe(1)

        // an explicit parentID (subagent/task) must NOT mint a new workspace —
        // children share the parent's workspace by construction
        const child = yield* createSession(test.directory, { parentID: parent.id })
        expect(child.parentID).toBe(parent.id)
        expect(child.workspaceID).toBeUndefined()
        expect(state.created).toBe(1)
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "honors an explicit workspaceID payload",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const test = yield* TestInstance
        const project = yield* Project.use.fromDirectory(test.directory)
        const { adapter, state } = overlayAdapter(path.join(test.directory, ".overlays"))
        registerAdapter(project.project.id, "overlay-test", adapter)

        // a workspace created explicitly (the manual opt-in flow)
        const manual = yield* request(WorkspacePaths.list, {
          method: "POST",
          headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
          body: JSON.stringify({ type: "overlay-test", branch: null }),
        }).pipe(Effect.flatMap(json<Workspace.Info>))
        expect(state.created).toBe(1)

        // a session created with an explicit workspaceID reuses it — the
        // default flag must not mint an extra workspace
        const session = yield* createSession(test.directory, { workspaceID: manual.id })
        expect(session.workspaceID).toBe(manual.id)
        expect(session.directory).toBe(manual.directory!)
        expect(state.created).toBe(1)
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "falls back to a trunk session when the adapter is not registered",
    () =>
      Effect.gen(function* () {
        // plugin absent (fresh boot before plugins load, or wrong type name):
        // session creation must still succeed, on the trunk directory
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        const test = yield* TestInstance
        // NOTE: no adapter registered for this project

        const session = yield* createSession(test.directory)
        expect(session.directory).toBe(test.directory)
        expect(session.workspaceID).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )

  it.instance(
    "subagents spawned inside the overlay instance share its directory",
    () =>
      Effect.gen(function* () {
        process.env.OPENCODE_NEW_SESSION_WORKSPACE = "overlay-test"
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const test = yield* TestInstance
        const project = yield* Project.use.fromDirectory(test.directory)
        const { adapter, state } = overlayAdapter(path.join(test.directory, ".overlays"))
        registerAdapter(project.project.id, "overlay-test", adapter)

        const parent = yield* createSession(test.directory)

        // the task tool creates child sessions from the ambient instance of the
        // running prompt — which routes into the parent's overlay directory.
        // Simulate exactly that: create a child with the overlay as ambient.
        const child = yield* Session.use.create({ parentID: parent.id }).pipe(
          provideInstanceEffect(parent.directory!),
        )
        expect(child.parentID).toBe(parent.id)
        expect(child.directory).toBe(parent.directory)
        expect(state.created).toBe(1) // no extra workspace for the child
      }),
    { git: true, config: { formatter: false, lsp: false } }, 20000,
  )
})
