import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { PersistentPty } from "@opencode-ai/core/persistent-pty"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Session } from "@opencode-ai/schema/session"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"

const cell = PluginRuntime.makeCell()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Global.node,
      Bus.node,
      PersistentPty.node,
      PluginRuntime.node,
      PluginRuntime.providerNodeWithCell(cell),
    ]),
    [
      Global.node.replace(tempGlobalLayer),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      PluginRuntime.node.replace(PluginRuntime.layerWithCell(cell)),
      PersistentPty.node.replace(PersistentPty.configured()),
    ],
  ),
)

describe("Plugin runtime terminal reads", () => {
  it.live("shares the configured global PTY service and validates lines before an empty selection", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      const persistentPty = yield* PersistentPty.Service
      const sessionID = Session.ID.make("ses_no_terminal")

      expect(cell.runtime?.persistentPty).toBe(persistentPty)
      expect(yield* runtime.persistentPty.read(sessionID)).toBeNull()
      expect(yield* runtime.persistentPty.read(sessionID, 1)).toBeNull()
      expect(yield* runtime.persistentPty.read(sessionID, 65535)).toBeNull()
      yield* Effect.forEach([0, -1, 1.5, 65536, NaN, Infinity], (lines) =>
        Effect.gen(function* () {
          const error = yield* runtime.persistentPty.read(sessionID, lines).pipe(Effect.flip)
          expect(error).toBeInstanceOf(PersistentPty.UnavailableError)
          expect(error.message).toContain("lines")
        }),
      )
    }),
  )
})
