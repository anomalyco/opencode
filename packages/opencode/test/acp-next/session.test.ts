import { describe, expect } from "bun:test"
import type { McpServer } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import * as ACPNextError from "@/acp-next/error"
import * as ACPNextSession from "@/acp-next/session"
import { ModelID, ProviderID } from "@/provider/schema"
import { testEffect } from "../lib/effect"

const sessionTest = testEffect(ACPNextSession.defaultLayer)

const model = (providerID: string, modelID: string): ACPNextSession.SelectedModel => ({
  providerID: ProviderID.make(providerID),
  modelID: ModelID.make(modelID),
})

const mcpServer: McpServer = {
  name: "local-tools",
  command: "node",
  args: ["server.js"],
  env: [],
}

describe("acp-next session state", () => {
  sessionTest.effect("creates and retrieves session state", () =>
    Effect.gen(function* () {
      const createdAt = new Date("2026-05-25T00:00:00.000Z")
      const created = yield* ACPNextSession.Service.use((session) =>
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
      const loaded = yield* ACPNextSession.Service.use((session) => session.get("ses_1"))

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
      const error = yield* ACPNextSession.Service.use((session) => session.get("ses_missing")).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ACPNextError.SessionNotFoundError)
      expect(error.sessionId).toBe("ses_missing")
    }),
  )

  sessionTest.effect("tryGet lets event routing ignore unknown sessions", () =>
    Effect.gen(function* () {
      const missing = yield* ACPNextSession.Service.use((session) => session.tryGet("ses_missing"))
      const missingPart = yield* ACPNextSession.Service.use((session) =>
        session.tryGetPartMetadata({ sessionId: "ses_missing", messageId: "msg_1", partId: "part_1" }),
      )

      expect(missing).toBeUndefined()
      expect(missingPart).toBeUndefined()
    }),
  )

  sessionTest.effect("updates selected model while preserving session identity and inputs", () =>
    Effect.gen(function* () {
      yield* ACPNextSession.Service.use((session) =>
        session.create({
          id: "ses_model",
          cwd: "/workspace",
          mcpServers: [mcpServer],
          model: model("anthropic", "claude-sonnet"),
          variant: "high",
          modeId: "build",
        }),
      )

      const updated = yield* ACPNextSession.Service.use((session) =>
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
      yield* ACPNextSession.Service.use((session) =>
        session.load({
          id: "ses_config",
          cwd: "/workspace",
          model: model("anthropic", "claude-sonnet"),
          variant: "low",
          modeId: "plan",
        }),
      )

      yield* ACPNextSession.Service.use((session) => session.setVariant("ses_config", "high"))
      expect(yield* ACPNextSession.Service.use((session) => session.getVariant("ses_config"))).toBe("high")
      expect(yield* ACPNextSession.Service.use((session) => session.getMode("ses_config"))).toBe("plan")

      yield* ACPNextSession.Service.use((session) => session.setMode("ses_config", "build"))
      expect(yield* ACPNextSession.Service.use((session) => session.getVariant("ses_config"))).toBe("high")
      expect(yield* ACPNextSession.Service.use((session) => session.getMode("ses_config"))).toBe("build")
    }),
  )

  sessionTest.effect("records known message part metadata for delta routing", () =>
    Effect.gen(function* () {
      yield* ACPNextSession.Service.use((session) => session.create({ id: "ses_parts", cwd: "/workspace" }))

      const metadata = yield* ACPNextSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_parts",
          messageId: "msg_1",
          partId: "part_1",
          toolCallId: "tool_1",
          metadata: { output: "first chunk" },
        }),
      )
      const routed = yield* ACPNextSession.Service.use((session) =>
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
      yield* ACPNextSession.Service.use((session) => session.create({ id: "ses_duplicate_parts", cwd: "/workspace" }))
      yield* ACPNextSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_duplicate_parts",
          messageId: "msg_1",
          partId: "part_1",
          metadata: { output: "from first message" },
        }),
      )
      yield* ACPNextSession.Service.use((session) =>
        session.recordPartMetadata({
          sessionId: "ses_duplicate_parts",
          messageId: "msg_2",
          partId: "part_1",
          metadata: { output: "from second message" },
        }),
      )

      const first = yield* ACPNextSession.Service.use((session) =>
        session.getPartMetadata({ sessionId: "ses_duplicate_parts", messageId: "msg_1", partId: "part_1" }),
      )
      const second = yield* ACPNextSession.Service.use((session) =>
        session.getPartMetadata({ sessionId: "ses_duplicate_parts", messageId: "msg_2", partId: "part_1" }),
      )

      expect(first?.metadata).toEqual({ output: "from first message" })
      expect(second?.metadata).toEqual({ output: "from second message" })
    }),
  )

  sessionTest.effect("removing a session clears its known part metadata", () =>
    Effect.gen(function* () {
      yield* ACPNextSession.Service.use((session) => session.create({ id: "ses_remove", cwd: "/workspace" }))
      yield* ACPNextSession.Service.use((session) =>
        session.recordPartMetadata({ sessionId: "ses_remove", messageId: "msg_1", partId: "part_1" }),
      )

      const removed = yield* ACPNextSession.Service.use((session) => session.remove("ses_remove"))
      const missing = yield* ACPNextSession.Service.use((session) => session.tryGet("ses_remove"))
      const missingPart = yield* ACPNextSession.Service.use((session) =>
        session.tryGetPartMetadata({ sessionId: "ses_remove", messageId: "msg_1", partId: "part_1" }),
      )

      expect(removed?.knownParts.size).toBe(1)
      expect(missing).toBeUndefined()
      expect(missingPart).toBeUndefined()
    }),
  )
})
