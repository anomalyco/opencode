import { afterEach, expect, mock, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Context, Deferred, Effect, Layer } from "effect"
// The layer only composes the host, so the modules around it are stubbed; each stub replaces a module `./index` imports.
const created: Array<{ state: unknown }> = []
const root = mkdtempSync(path.join(tmpdir(), "opencode-extensions-layer-"))

// Windows keeps the sqlite file open briefly, so cleanup is best effort.
afterEach(() => rm(root, { recursive: true, force: true }).catch(() => undefined))
function createHost(input: { state: unknown }) {
  created.push({ state: input.state })
  return { dispose: () => {} }
}

mock.module("./host", () => ({ createHost }))
mock.module("./assets", () => ({ extensionAsset: () => undefined }))
mock.module("../windows", () => ({ setAppQuitting: () => {} }))
mock.module("../windows/protocol", () => ({ setExtensionAssets: () => {} }))
const CliService = Context.Service<{
  readonly resolve: Effect.Effect<{ readonly version: string; readonly command: readonly string[] }>
}>()("test/DesktopCli")
const LifecycleService = Context.Service<{ readonly prepareToRestart: Effect.Effect<void> }>()("test/ApplicationLifecycle")
mock.module("../service/desktop-cli", () => ({ DesktopCli: { Service: CliService } }))
mock.module("../lifecycle", () => ({ ApplicationLifecycle: { Service: LifecycleService } }))
const { DesktopStorage } = await import("../storage")
const { Shutdown } = await import("../lifecycle/shutdown")
const { Extensions } = await import(".")

test("the extensions host reads storage state only after the storage import committed", async () => {
  const ready = await Effect.runPromise(Deferred.make<void>())
  const storage = DesktopStorage.make(path.join(root, "drafts.sqlite"))

  // The host builds its stores over `state` in the same `.then` that reads it, so it must not load
  // during the legacy import: a read there would cache the pre-import value for the process lifetime.
  // Only evaluating the ready effect opens the gate, so a load that skips awaiting it throws on the
  // read rather than passing on microtask ordering.
  let committed = false
  const service = Object.assign({}, storage, {
    ready: Deferred.await(ready).pipe(Effect.tap(() => Effect.sync(() => void (committed = true)))),
  })
  Object.defineProperty(service, "state", {
    get() {
      if (!committed) throw new Error("storage state read before the legacy import committed")
      return storage.state
    },
  })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          Extensions.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(DesktopStorage.Service, service),
                Layer.succeed(Shutdown.Service, { add: () => Effect.succeed(() => {}), run: Effect.void }),
                Layer.succeed(CliService, { resolve: Effect.succeed({ version: "0.0.0", command: [] }) }),
                Layer.succeed(LifecycleService, { prepareToRestart: Effect.void }),
              ),
            ),
          ),
        )
        const loading = Context.get(context, Extensions.Service).host()
        yield* Deferred.succeed(ready, undefined)
        yield* Effect.promise(() => loading)
      }),
    ),
  )

  expect(created.length).toBe(1)
  expect(created.at(0)?.state).toBe(storage.state)
})
