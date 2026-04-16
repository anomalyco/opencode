import { Effect, Stream } from "effect"
import { Workspace as WorkspaceErrors } from "../errors"
import type { Workspace } from "../types"

export const THROWING_BACKEND_MARKER = "throwing-backend"

export namespace ThrowingBackend {
  const err = (method: string, p?: string) =>
    new WorkspaceErrors.BackendError({
      backend: THROWING_BACKEND_MARKER,
      method,
      path: p,
      cause: new Error(`${THROWING_BACKEND_MARKER}: ${method} not supported`),
    })

  export const make = (rootPath = "/throwing"): Workspace.Backend => ({
    id: THROWING_BACKEND_MARKER,
    rootPath,
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
  })
}
