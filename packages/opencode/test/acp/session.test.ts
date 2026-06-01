import { describe, expect } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as ACPError from "@/acp/error"
import * as ACPSession from "@/acp/session"
import { testEffect } from "../lib/effect"

const sessionTest = testEffect(ACPSession.defaultLayer)

const model = (providerID: string, modelID: string): ACPSession.SelectedModel => ({
  providerID: ProviderV2.ID.make(providerID),
  modelID: ProviderV2.ModelID.make(modelID),
})

const mcpServer: McpServer = {
  name: "local-tools",
  command: "node",
  args: ["server.js"],
  env: [],
}

describe("acp session state", () => {
  sessionTest.effect("creates and retrieves session state", () =>
    Effect.gen(function* () {
      const createdAt = new Date("2026-05-25T00:00:00.000Z")
      const created = yield* ACPSession.Service.use((session) =>
        session.create({
          id: "ses_1",
          cwd: "/workspace",
          mcpServers: [mcpServer],
          createdAt,
          model: model("anthropic", "claude-sonnet"),
          variant: "high",
          modeId: "build",
        }),
      )
      const loaded = yield* ACPSession.Service.use((session) => session.get("ses_1"))

      expect(created).toMatchObject({
        id: "ses_1",
        cwd: "/workspace",
        mcpServers: [mcpServer],
        model: model("anthropic", "claude-sonnet"),
        variant: "high",
        modeId: "build",
      })
      expect(loaded.createdAt).toEqual(createdAt)
      expect(loaded.knownParts.size).toBe(0)
    }),
  )

  sessionTest.effect("fails required lookups with typed SessionNotFound", () =>
    Effect.gen(function* () {
      const error = yield* ACPSession.Service.use((session) => session.get("ses_missing")).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ACPError.SessionNotFoundError)
      expect(error.sessionId).toBe("ses_missing")
    }),
  )

  sessionTest.effect("tryGet lets event routing ignore unknown sessions", () =>
    Effect.gen(function* () {
      const missing = yield* ACPSession.Service.use((session) => session.tryGet("ses_missing"))
      const missingPart = yield* ACPSession.Service.use((session) =>
        session.tryGetPartMetadata({ sessionId: "ses_missing", messageId: "msg_1", partId: "part_1" }),
      )

      expect(missing).toBeUndefined()
      expect(missingPart).toBeUndefined()
    }),
  )

  sessionTest.effect("updates selected model while preserving session identity and inputs", () =>
    Effect.gen(function* () {
      yield* ACPSession.Service.use((session) =>
        session.create({
          id: "ses_model",
          cwd: "/workspace",
          mcpServers: [mcpServer],
          model: model("anthropic", "claude-sonnet"),
          variant: "high",
          modeId: "build",
        }),
      )

      const updated = yield* ACPSession.Service.use((session) =>
        session.setModel("ses_model", model("openai", "gpt-5")),
      )

      expect(updated.id).toBe("ses_model")
      expect(updated.cwd).toBe("/workspace")
      expect(updated.mcpServers).toEqual([mcpServer])
      expect(updated.model).toEqual(model("openai", "gpt-5"))
      expect(updated.variant).toBe("high")
      expect(updated.modeId).toBe("build")
    }),
  )

  sessionTest.effect("updates selected variant and mode independently", () =>
    Effect.gen(function* () {
      yield* ACPSession.Service.use((session) =>
        session.load({
          id: "ses_config",
          cwd: "/workspace",
          model: model("anthropic", "claude-sonnet"),
          variant: "low",
          modeId: "plan",
        }),
      )

      yield* ACPSession.Service.use((session) => session.setVariant("ses_config", "high"))
      expect(yield* ACPSession.Service.use((session) => session.getVariant("ses_config"))).toBe("high")
      expect(yield* ACPSession.Service.use((session) => session.getMode("ses_config"))).toBe("plan")

      yield* ACPSession.Service.use((session) => session.setMode("ses_config", "build"))
      expect(yield* ACPSession.Service.use((session) => session.getVariant("ses_config"))).toBe("high")
      expect(yield* ACPSession.Service.use((session) => session.getMode("ses_config"))).toBe("build")
    }),
  )

  sessionTest.effect("records known message part metadata for delta routing", () =>
    Effect.gen(function* () {
      yield* ACPSession.Service.use((session) => session.create({ id: "ses_parts", cwd: "/workspace" }))

      const metadata = yield* ACPSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_parts",
          messageId: "msg_1",
          partId: "part_1",
          toolCallId: "tool_1",
          metadata: { output: "first chunk" },
        }),
      )
      const routed = yield* ACPSession.Service.use((session) =>
        session.getPartMetadata({ sessionId: "ses_parts", messageId: "msg_1", partId: "part_1" }),
      )

      expect(metadata).toEqual({
        messageId: "msg_1",
        partId: "part_1",
        toolCallId: "tool_1",
        metadata: { output: "first chunk" },
      })
      expect(routed).toEqual(metadata)
    }),
  )

  sessionTest.effect("keeps repeated part ids distinct across messages", () =>
    Effect.gen(function* () {
      yield* ACPSession.Service.use((session) => session.create({ id: "ses_duplicate_parts", cwd: "/workspace" }))
      yield* ACPSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_duplicate_parts",
          messageId: "msg_1",
          partId: "part_1",
          metadata: { output: "from first message" },
        }),
      )
      yield* ACPSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_duplicate_parts",
          messageId: "msg_2",
          partId: "part_1",
          metadata: { output: "from second message" },
        }),
      )

      const first = yield* ACPSession.Service.use((session) =>
        session.getPartMetadata({ sessionId: "ses_duplicate_parts", messageId: "msg_1", partId: "part_1" }),
      )
      const second = yield* ACPSession.Service.use((session) =>
        session.getPartMetadata({ sessionId: "ses_duplicate_parts", messageId: "msg_2", partId: "part_1" }),
      )

      expect(first?.metadata).toEqual({ output: "from first message" })
      expect(second?.metadata).toEqual({ output: "from second message" })
    }),
  )

  sessionTest.effect("removing a session clears its known part metadata", () =>
    Effect.gen(function* () {
      yield* ACPSession.Service.use((session) => session.create({ id: "ses_remove", cwd: "/workspace" }))
      yield* ACPSession.Service.use((session) =>
        session.recordPartMetadata({ sessionId: "ses_remove", messageId: "msg_1", partId: "part_1" }),
      )

      const removed = yield* ACPSession.Service.use((session) => session.remove("ses_remove"))
      const missing = yield* ACPSession.Service.use((session) => session.tryGet("ses_remove"))
      const missingPart = yield* ACPSession.Service.use((session) =>
        session.tryGetPartMetadata({ sessionId: "ses_remove", messageId: "msg_1", partId: "part_1" }),
      )

      expect(removed?.knownParts.size).toBe(1)
      expect(missing).toBeUndefined()
      expect(missingPart).toBeUndefined()
    }),
  )
})
