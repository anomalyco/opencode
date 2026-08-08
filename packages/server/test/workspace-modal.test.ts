import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeFiles } from "@opencode-ai/core/environment"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { modalWorkspaceDriver, provider } from "../src/workspace/modal-workspace"

const enabled =
  !!process.env.OPENCODE_TEST_MODAL &&
  ((!!process.env.MODAL_TOKEN_ID && !!process.env.MODAL_TOKEN_SECRET) ||
    fs.existsSync(path.join(os.homedir(), ".modal.toml")))

const testLayer = Layer.provideMerge(
  AppNodeBuilder.build(Workspace.configured({ idleThreshold: "1 minute", pollInterval: "1 minute" }), [
    [
      WorkspaceDriver.node,
      WorkspaceDriver.registryNode({ [provider]: modalWorkspaceDriver({ app: "opencode-workspace-tests" }) }),
    ],
  ]),
  TestClock.layer(),
)
const modalTest = enabled ? test : test.skip

modalTest(
  "wakes a workspace from its filesystem snapshot",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const workspace = yield* Workspace.Service
        yield* Effect.acquireUseRelease(
          workspace.create(provider),
          (created) =>
            Effect.gen(function* () {
              const environment = yield* workspace.connect(created.id)
              const files = makeFiles(environment)
              const file = `/tmp/opencode-workspace-${crypto.randomUUID()}.txt`
              yield* files.write(file, new TextEncoder().encode("survived snapshot"))

              yield* TestClock.adjust("2 minutes")

              const restored = yield* files.read(file)
              expect(new TextDecoder().decode(restored.bytes)).toBe("survived snapshot")
            }),
          (created) => workspace.destroy(created.id).pipe(Effect.ignore),
        )
      }).pipe(Effect.scoped, Effect.provide(testLayer)),
    ),
  180_000,
)
