// runtime/media-store.ts
// MediaStore — Effect service for downloading and storing media files
// from chat platforms (Telegram, Discord, etc.) with scope-based lifecycle.

import { Context, Effect, Layer } from "effect"

export type CleanupPolicy = "delete_on_cleanup" | "keep"

export interface MediaMeta {
  readonly filename: string
  readonly source: string
  readonly cleanupPolicy: CleanupPolicy
}

export interface Interface {
  readonly store: (localPath: string, meta: MediaMeta, scope: string) => Effect.Effect<string, Error>
  readonly resolve: (ref: string) => Effect.Effect<string, Error>
  readonly cleanup: (scope: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MediaStore") {}

interface Entry {
  path: string
  meta: MediaMeta
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const refs = new Map<string, Entry>()
    const scopeToRefs = new Map<string, Set<string>>()
    let refCounter = 0

    const store = (localPath: string, meta: MediaMeta, scope: string) =>
      Effect.gen(function* () {
        const file = Bun.file(localPath)
        const exists = yield* Effect.tryPromise({
          try: () => file.exists(),
          catch: (error) => new Error(`Failed to stat media file: ${String(error)}`),
        })

        if (!exists) {
          return yield* Effect.fail(new Error(`Media file not found: ${localPath}`))
        }

        const ref = `media://${++refCounter}/${meta.filename}`
        refs.set(ref, { path: localPath, meta })

        let scoped = scopeToRefs.get(scope)
        if (!scoped) {
          scoped = new Set()
          scopeToRefs.set(scope, scoped)
        }
        scoped.add(ref)

        return ref
      })

    const resolve = (ref: string) =>
      Effect.gen(function* () {
        const entry = refs.get(ref)
        if (!entry) return yield* Effect.fail(new Error(`Unknown media ref: ${ref}`))
        return entry.path
      })

    const cleanup = (scope: string) =>
      Effect.gen(function* () {
        const scoped = scopeToRefs.get(scope)
        if (!scoped) return yield* Effect.void

        for (const ref of scoped) {
          const entryOpt = refs.get(ref)
          refs.delete(ref)
          if (!entryOpt) continue
          const entry = entryOpt

          if (entry.meta.cleanupPolicy === "delete_on_cleanup") {
            yield* Effect.tryPromise({
              try: async () => {
                const file = Bun.file(entry.path)
                if (await file.exists()) {
                  await file.delete()
                }
              },
              catch: () => new Error("cleanup failed"),
            }).pipe(Effect.ignore)
          }
        }

        scopeToRefs.delete(scope)
        return yield* Effect.void
      })

    return Service.of({ store, resolve, cleanup })
  }),
)

export const defaultLayer = layer

export * as MediaStore from "./media-store"
