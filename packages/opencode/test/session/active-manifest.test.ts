import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { ActiveManifest } from "@/session/active-manifest"

const it = testEffect(Layer.empty)

const sampleEntry = {
  id: "session-001",
  model: { id: "claude-sonnet", providerID: "anthropic" },
  agent: "build",
  timestamp: Date.now(),
}

it.live("writeActiveSession creates manifest with session", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe("session-001")
    }),
  ),
)

it.live("writeActiveSession adds to existing manifest", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      yield* ActiveManifest.write({
        id: "session-002",
        model: { id: "gpt-4", providerID: "openai" },
        agent: "general",
        timestamp: Date.now(),
      })
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(2)
    }),
  ),
)

it.live("writeActiveSession updates existing session", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      yield* ActiveManifest.write({ ...sampleEntry, agent: "plan" })
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].agent).toBe("plan")
    }),
  ),
)

it.live("removeActiveSession removes from manifest", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      yield* ActiveManifest.remove("session-001")
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(0)
    }),
  ),
)

it.live("clearActiveSessions deletes the manifest file", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      yield* ActiveManifest.clear()
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(0)
    }),
  ),
)

it.live("hasCrashed returns false when no manifest exists", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const crashed = yield* ActiveManifest.hasCrashed()
      expect(crashed).toBe(false)
    }),
  ),
)

it.live("hasCrashed returns true when manifest exists", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* ActiveManifest.write(sampleEntry)
      const crashed = yield* ActiveManifest.hasCrashed()
      expect(crashed).toBe(true)
    }),
  ),
)

it.live("read returns empty array when manifest does not exist", () =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const sessions = yield* ActiveManifest.read()
      expect(sessions).toHaveLength(0)
    }),
  ),
)
