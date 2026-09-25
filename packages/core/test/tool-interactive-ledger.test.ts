import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { InteractiveLedger } from "@opencode-ai/core/tool/interactive/ledger"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_interactive_ledger")

/**
 * Spawns a real POSIX sleeper that is its own process-group leader, so a
 * recorded `pgid` matches a killable process group (spec R30/R36). `setsid`
 * makes the spawned pid the group leader; the promise resolves when the
 * process dies (a live `sleep 30` would only exit after its timeout, which
 * the bun test timeout surfaces as a failure).
 */
const spawnSleeper = () => {
  const proc = Bun.spawn({ cmd: ["setsid", "sleep", "30"] })
  return {
    pgid: proc.pid,
    exited: Effect.promise(() => proc.exited.then(() => undefined)),
    kill: Effect.sync(() => proc.kill()),
  }
}

const withLedger = <A, E, R>(
  body: (input: { ledger: InteractiveLedger.Interface; dataDir: string }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const graph = AppNodeBuilder.build(LayerNode.group([InteractiveLedger.node, FSUtil.node]), [
        [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })))],
        [Global.node, Global.layerWith({ data: tmp.path })],
      ])
      return Effect.gen(function* () {
        return yield* body({ ledger: yield* InteractiveLedger.Service, dataDir: tmp.path })
      }).pipe(Effect.provide(graph))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const it = testEffect(Layer.empty)

/** Locates the ledger's jobs.json under the data directory (the key is an internal hash). */
const readLedgerRows = async (dataDir: string): Promise<Array<{ jobID: string; pgid: number }>> => {
  const entries = await fs.readdir(dataDir, { recursive: true })
  const file = entries.find((entry) => entry.endsWith("jobs.json"))
  if (!file) return []
  const raw = await Bun.file(path.join(dataDir, file)).text()
  return raw.trim() === "" ? [] : JSON.parse(raw)
}

if (process.platform !== "win32") {
  describe("InteractiveLedger", () => {
    it.live("sweep kills every recorded live process group and drops the rows idempotently", () =>
      withLedger(({ ledger }) =>
        Effect.gen(function* () {
          const first = spawnSleeper()
          const second = spawnSleeper()
          yield* ledger.record({ jobID: "ijob_a", sessionID, pgid: first.pgid, startedAt: Date.now() })
          yield* ledger.record({ jobID: "ijob_b", sessionID, pgid: second.pgid, startedAt: Date.now() })

          expect(yield* ledger.sweep()).toBe(2)
          yield* first.exited
          yield* second.exited
          expect(yield* ledger.sweep()).toBe(0)

          yield* first.kill
          yield* second.kill
        }),
      ))

    it.live("remove drops the row so sweep reaps nothing", () =>
      withLedger(({ ledger }) =>
        Effect.gen(function* () {
          const sleeper = spawnSleeper()
          yield* ledger.record({ jobID: "ijob_a", sessionID, pgid: sleeper.pgid, startedAt: Date.now() })
          yield* ledger.remove("ijob_a")

          expect(yield* ledger.sweep()).toBe(0)

          yield* sleeper.kill
          yield* sleeper.exited
        }),
      ))

    it.live("concurrent record and remove serialize without losing updates (spec R30)", () =>
      withLedger(({ ledger, dataDir }) =>
        Effect.gen(function* () {
          yield* ledger.record({ jobID: "ijob_gone", sessionID, pgid: 4100, startedAt: 0 })
          yield* Effect.all(
            [
              ...Array.from({ length: 12 }, (_, i) =>
                ledger.record({ jobID: `ijob_keep_${i}`, sessionID, pgid: 4200 + i, startedAt: 0 }),
              ),
              ledger.remove("ijob_gone"),
            ],
            { concurrency: "unbounded" },
          )

          const rows = yield* Effect.promise(() => readLedgerRows(dataDir))
          expect(rows.map((row) => row.jobID).sort()).toEqual(
            Array.from({ length: 12 }, (_, i) => `ijob_keep_${i}`).sort(),
          )
          expect(new Set(rows.map((row) => row.pgid)).size).toBe(12)
        }),
      ))
  })
}
