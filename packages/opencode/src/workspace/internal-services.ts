// Internal L4 surfaces used by Workspace.Service's post-write orchestration.
// `nullLayer` provides no-op implementations for test fixtures that don't
// wire the real Format/Bus/LSP graph. Real implementations live in
// ./runtime.ts — the app-level assembly point.

import { Context, Effect, Layer } from "effect"

export namespace WorkspaceFormat {
  export interface Interface {
    readonly file: (path: string) => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceFormat") {}

  export const nullLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    Service.of({
      file: () => Effect.void,
    }),
  )
}

export namespace WorkspaceBus {
  export interface Interface {
    readonly fileEdited: (file: string) => Effect.Effect<void>
    readonly fileWatcherUpdated: (file: string, event: "add" | "change" | "unlink") => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceBus") {}

  export const nullLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    Service.of({
      fileEdited: () => Effect.void,
      fileWatcherUpdated: () => Effect.void,
    }),
  )
}

export namespace WorkspaceLsp {
  export interface Interface {
    readonly touchFile: (file: string, wait: boolean) => Effect.Effect<void>
    readonly diagnostics: () => Effect.Effect<Record<string, unknown[]>>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceLsp") {}

  export const nullLayer: Layer.Layer<Service> = Layer.succeed(
    Service,
    Service.of({
      touchFile: () => Effect.void,
      diagnostics: () => Effect.succeed({} as Record<string, unknown[]>),
    }),
  )
}
