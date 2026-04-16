// Vercel-backend FileWatcher.Service implementation.
//
// The host FileWatcher uses @parcel/watcher with a native binding,
// which can't run inside a Vercel sandbox. On vercel mode the agent
// is the only writer to the tenant filesystem, so external fs events
// carry no information — a no-op service is the correct behavior.
// FileWatcher.defaultLayer dispatches to this layer when
// OPENCODE_WORKSPACE_BACKEND=vercel.

import { Effect, Layer } from "effect"
import { FileWatcher } from "@/file/watcher"

export const layer: Layer.Layer<FileWatcher.Service> = Layer.succeed(
  FileWatcher.Service,
  FileWatcher.Service.of({
    init: () => Effect.void,
  }),
)
