// Workspace.Primitives error-surface contract: every BackendError from
// the underlying Backend is mapped to a WorkspaceError with the primitive
// name preserved in `method` and the original error available via `cause`.

import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { Workspace } from "../../src/workspace"
import { Workspace as WorkspaceErrors } from "../../src/workspace/errors"
import { WorkspaceRouter } from "../../src/workspace/router"
import type { Workspace as WorkspaceTypes } from "../../src/workspace/types"
import { WorkspaceError } from "../../src/workspace/workspace-error"

const err = (method: string, p?: string) =>
  new WorkspaceErrors.BackendError({
    backend: "stub",
    method,
    path: p,
    cause: new Error(`stub-backend: ${method}`),
  })

const stubBackend: WorkspaceTypes.Backend = {
  id: "stub",
  rootPath: "/stub",
  shell: "/bin/sh",
  close: Effect.void,
  stat: (p) => Effect.fail(err("stat", p)),
  exists: (p) => Effect.fail(err("exists", p)),
  readFile: (p) => Effect.fail(err("readFile", p)),
  writeFile: (p) => Effect.fail(err("writeFile", p)),
  mkDir: (p) => Effect.fail(err("mkDir", p)),
  readDir: (p) => Effect.fail(err("readDir", p)),
  remove: (p) => Effect.fail(err("remove", p)),
  rename: (from) => Effect.fail(err("rename", from)),
  exec: () => Effect.fail(err("exec")),
  execStream: () => Effect.fail(err("execStream")),
  watch: (p) => Stream.fail(err("watch", p)),
}

const fixedRouter: Layer.Layer<WorkspaceRouter.Service> = Layer.succeed(
  WorkspaceRouter.Service,
  WorkspaceRouter.Service.of({
    backend: Effect.succeed(stubBackend) as Effect.Effect<WorkspaceTypes.Backend, WorkspaceError>,
  }),
)

const runtime = ManagedRuntime.make(Workspace.Primitives.layer.pipe(Layer.provide(fixedRouter)))

const expectWrapped = async (
  method: string,
  build: (ws: Workspace.Primitives.Interface) => Effect.Effect<unknown, WorkspaceError>,
) => {
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const ws = yield* Workspace.Primitives.Service
      return yield* build(ws)
    }),
  )
  if (exit._tag === "Success") {
    throw new Error(`expected WorkspaceError on ${method}, got success`)
  }
  const repr = JSON.stringify(exit.cause)
  expect(repr).toContain("WorkspaceError")
  expect(repr).toContain(method)
  // Backend error preserved in the cause chain.
  expect(repr).toContain("WorkspaceBackendError")
}

describe("Workspace.Primitives — BackendError → WorkspaceError mapping", () => {
  test("stat preserves method", () => expectWrapped("stat", (ws) => ws.stat("/x")))
  test("exists preserves method", () => expectWrapped("exists", (ws) => ws.exists("/x")))
  test("readFile preserves method", () => expectWrapped("readFile", (ws) => ws.readFile("/x")))
  test("writeFile preserves method", () => expectWrapped("writeFile", (ws) => ws.writeFile("/x", "data")))
  test("mkDir preserves method", () => expectWrapped("mkDir", (ws) => ws.mkDir("/x")))
  test("readDir preserves method", () => expectWrapped("readDir", (ws) => ws.readDir("/x")))
  test("remove preserves method", () => expectWrapped("remove", (ws) => ws.remove("/x")))
  test("rename preserves method", () => expectWrapped("rename", (ws) => ws.rename("/a", "/b")))
  test("exec preserves method", () => expectWrapped("exec", (ws) => ws.exec("true", [])))
  test("search preserves method", () =>
    expectWrapped("search", (ws) => ws.search({ pattern: "anything" })))

  test("watch surfaces WorkspaceError on the stream", async () => {
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const ws = yield* Workspace.Primitives.Service
        return yield* Stream.runCollect(ws.watch("/x"))
      }),
    )
    if (exit._tag === "Success") {
      throw new Error(`expected watch to fail, got success`)
    }
    const repr = JSON.stringify(exit.cause)
    expect(repr).toContain("WorkspaceError")
    expect(repr).toContain("watch")
  })
})
