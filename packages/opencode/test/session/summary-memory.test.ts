import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionSummary.defaultLayer,
  Snapshot.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(env)

const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// A large, unique file body so any retained full-text patch is unmistakable.
const BIG = Array.from({ length: 4000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n")

describe("session summary memory retention", () => {
  it.live(
    "does not retain full patch text in stored summary diffs, but diff() still returns it",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const snapshot = yield* Snapshot.Service

          yield* Effect.promise(() => fs.writeFile(path.join(dir, "big.txt"), "seed\n"))

          const info = yield* session.create({})
          const sid = info.id as SessionID

          const u = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user" as const,
            sessionID: sid,
            agent: "default",
            model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
            time: { created: Date.now() },
          })

          const a = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "assistant" as const,
            sessionID: sid,
            mode: "default",
            agent: "default",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens,
            modelID: ModelV2.ID.make("gpt-4"),
            providerID: ProviderV2.ID.make("openai"),
            parentID: u.id,
            time: { created: Date.now() },
            finish: "end_turn",
          })

          const before = yield* snapshot.track()
          if (!before) throw new Error("expected before snapshot")
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "big.txt"), BIG))
          const after = yield* snapshot.track()
          if (!after) throw new Error("expected after snapshot")

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: a.id,
            sessionID: sid,
            type: "step-start" as const,
            snapshot: before,
          })
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: a.id,
            sessionID: sid,
            type: "step-finish" as const,
            reason: "stop",
            snapshot: after,
            cost: 0,
            tokens,
          })

          yield* summary.summarize({ sessionID: sid, messageID: u.id })

          // Re-read the persisted/hydrated message to inspect what is RETAINED.
          const messages = yield* session.messages({ sessionID: sid })
          const target = messages.find((m) => m.info.id === u.id)
          if (!target || target.info.role !== "user") throw new Error("no user message")
          const stored = target.info.summary?.diffs ?? []

          // The fix: stored diffs carry metadata but NOT the heavy patch text.
          expect(stored.length).toBeGreaterThan(0)
          for (const d of stored) {
            expect(d.patch).toBeUndefined()
          }
          // Aggregate counts still computed.
          expect(target.info.summary?.files).toBe(stored.length)

          // But diff() still reconstructs full patch text on demand.
          const onDemand = yield* summary.diff({ sessionID: sid, messageID: u.id })
          expect(onDemand.length).toBeGreaterThan(0)
          const withText = onDemand.filter((d) => typeof d.patch === "string" && d.patch.length > 0)
          expect(withText.length).toBeGreaterThan(0)
        }),
      { git: true },
    ),
  )
})
