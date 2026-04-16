// App-level composition point for Workspace.Service. Split from index.ts
// so Format/Bus/LSP can be wired with ordinary imports without cycling
// back through Primitives.

import { Effect, Layer } from "effect"
import { Workspace } from "./index"
import { WorkspaceBus, WorkspaceFormat, WorkspaceLsp } from "./internal-services"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format"
import { LSP } from "@/lsp"

export namespace WorkspaceRuntime {
  const workspaceFormatLayer: Layer.Layer<WorkspaceFormat.Service, never, never> = Layer.effect(
    WorkspaceFormat.Service,
    Effect.gen(function* () {
      const format = yield* Format.Service
      return WorkspaceFormat.Service.of({
        file: (p: string) => format.file(p).pipe(Effect.catch(() => Effect.void)),
      })
    }),
  ).pipe(Layer.provide(Format.defaultLayer))

  // Publishes through the module-global Bus.publish static rather than
  // yielding Bus.Service — matches the singleton bus the server runtime
  // uses and keeps this layer's requirement set empty.
  const workspaceBusLayer: Layer.Layer<WorkspaceBus.Service> = Layer.succeed(
    WorkspaceBus.Service,
    WorkspaceBus.Service.of({
      fileEdited: (file) =>
        Effect.promise(async () => {
          await Bus.publish(File.Event.Edited, { file })
        }).pipe(Effect.catch(() => Effect.void)),
      fileWatcherUpdated: (file, event) =>
        Effect.promise(async () => {
          await Bus.publish(FileWatcher.Event.Updated, { file, event })
        }).pipe(Effect.catch(() => Effect.void)),
    }),
  )

  const workspaceLspLayer: Layer.Layer<WorkspaceLsp.Service, never, never> = Layer.effect(
    WorkspaceLsp.Service,
    Effect.gen(function* () {
      const lsp = yield* LSP.Service
      return WorkspaceLsp.Service.of({
        touchFile: (file: string, wait: boolean) =>
          lsp.touchFile(file, wait).pipe(Effect.catch(() => Effect.void)),
        diagnostics: () =>
          lsp
            .diagnostics()
            .pipe(Effect.catch(() => Effect.succeed({} as Record<string, unknown[]>))),
      })
    }),
  ).pipe(Layer.provide(LSP.defaultLayer))

  export const defaultLayer: Layer.Layer<Workspace.Service.Tag, never, never> = Workspace.Service.layer.pipe(
    Layer.provide(Workspace.Primitives.defaultLayer),
    Layer.provide(workspaceFormatLayer),
    Layer.provide(workspaceBusLayer),
    Layer.provide(workspaceLspLayer),
  )
}
