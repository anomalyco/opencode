import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { WindowSnapshotChannel } from "../../shared/ipc-transport"
import { electron } from "../../../test/preload"
import { layer } from "./index"
import { registerStorageSnapshotHandler } from "./snapshot"

const roots: string[] = []

// Bun's node:sqlite shim can retain file handles on Windows after close; only these owned test directories are removed.
afterEach(() => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))))

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-storage-layer-"))
  roots.push(root)

  return root
}

registerStorageSnapshotHandler()

describe("storage layer", () => {
  test("the snapshot handler waits for the legacy import", async () => {
    const root = tempRoot()
    writeFileSync(path.join(root, "opencode.global.dat"), JSON.stringify({ model: "m" }))
    electron.userData = root

    // The preload asks for the namespaces its shell reads before the page runs. The answer must not
    // race the legacy import: the renderer loads a namespace once, so an empty answer is final.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Layer.build(layer.pipe(Layer.provide(Layer.merge(NodePath.layer, NodeFileSystem.layer))))
        const handler = electron.handlers.get(WindowSnapshotChannel)

        if (!handler) throw new Error("the snapshot handler was not registered")

        return yield* Effect.promise(() =>
          Promise.resolve(handler({ senderFrame: { url: "oc://renderer/index.html" } }, ["opencode.global.dat"])),
        )
      }).pipe(Effect.scoped),
    )

    expect(result).toEqual({
      storage: { "opencode.global.dat": { items: { model: "m" }, revision: 0 } },
      extensions: [],
    })
  })
})
