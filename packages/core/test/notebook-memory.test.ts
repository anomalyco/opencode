import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { NotebookMemory } from "@opencode-ai/core/notebook/memory"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const memoryLayer = (project: string) =>
  AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, NotebookMemory.node]), [
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(project) }, { projectDirectory: AbsolutePath.make(project) }),
        ),
      ),
    ],
  ])

const load = (project: string) =>
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((service) => service.load()),
    Effect.provide(memoryLayer(project)),
  )

const inTemp = <A, E>(body: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    body,
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("NotebookMemory", () => {
  it.live("injects a notebook memory digest into the system baseline", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const src = path.join(tmp.path, "src")
        yield* Effect.promise(() => fs.mkdir(src, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(src, "lib.ts"), "export const util = 1\n"))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, ".note.yaml"),
            "version: 1\nupdated: ''\nsummary: Project root bundles everything.\n",
          ),
        )
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(src, ".note.yaml"),
            "version: 1\nupdated: ''\nsummary: Core library lives here.\nentries:\n  lib.ts:\n    summary: Provides the util helper.\n    based_on:\n      - 'src/lib.ts@2-1'\n",
          ),
        )

        const initialized = yield* SystemContext.initialize(yield* load(tmp.path))
        expect(initialized.baseline).toContain("## Notebook memory")
        expect(initialized.baseline).toContain("Project root bundles everything.")
        expect(initialized.baseline).toContain("Core library lives here.")
        expect(initialized.baseline).toContain("Provides the util helper.")
      }),
    ),
  )

  it.live("produces an empty context when no notebooks exist", () =>
    inTemp((tmp) =>
      Effect.gen(function* () {
        const initialized = yield* SystemContext.initialize(yield* load(tmp.path))
        expect(initialized.baseline).not.toContain("Notebook memory")
      }),
    ),
  )
})
