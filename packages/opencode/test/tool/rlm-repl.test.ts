import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { RLMReplTool } from "@/tool/rlm-repl"
import { Tool } from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Layer.mock(Session.Service)({}))

const it = testEffect(layer)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

const runRlm = (code: string, agent?: string) =>
  Effect.gen(function* () {
    const info = yield* RLMReplTool
    const tool = yield* Tool.init(info)
    return yield* tool.execute({ code, agent }, ctx)
  })

describe("RLMReplTool", () => {
  it.instance("executes JavaScript and returns metadata", () =>
    Effect.gen(function* () {
      const result = yield* runRlm("return ['alpha', 'beta'].join('-')")

      expect(result.title).toBe("RLM execution (0 sub-calls)")
      expect(result.output).toContain("alpha-beta")
      expect(result.output).toContain("<rlm_metadata>")
      expect(result.metadata.subLLMCalls).toBe(0)
      expect(result.metadata.contextKeys).toEqual([])
    }),
  )

  it.instance("stores, loads, and chunks context by pointer", () =>
    Effect.gen(function* () {
      const result = yield* runRlm(
        [
          'context.store("input", "abcdef")',
          'const chunks = context.chunk("input", 2)',
          "return chunks.map((key) => context.load(key)).join('|')",
        ].join("\n"),
      )

      expect(result.output).toContain("ab|cd|ef")
      expect(result.metadata.contextKeys).toEqual(["input", "input_chunk_0", "input_chunk_1", "input_chunk_2"])
    }),
  )

  it.instance("blocks constructor-chain sandbox escape attempts", () =>
    Effect.gen(function* () {
      const result = yield* runRlm(
        [
          "try {",
          "  return [].constructor.constructor('return process')().versions.node",
          "} catch (_error) {",
          "  return 'blocked'",
          "}",
        ].join("\n"),
      )

      expect(result.output).toContain("blocked")
      expect(result.output).not.toContain(process.versions.node)
    }),
  )

  it.instance("enforces context store size limit", () =>
    Effect.gen(function* () {
      const result = yield* runRlm('context.store("big", "x".repeat(10 * 1024 * 1024 + 1)); return "unreachable"')

      expect(result.title).toBe("RLM execution failed")
      expect(result.metadata.error).toContain("Context store limit exceeded")
      expect(result.output).toContain("Sub-LLM calls made before error: 0")
    }),
  )

  it.instance("rejects sub-LLM calls beyond the execution limit before spawning sessions", () =>
    Effect.gen(function* () {
      const result = yield* runRlm("return await sub_llm_parallel(Array.from({ length: 51 }, () => 'work'))")

      expect(result.title).toBe("RLM execution failed")
      expect(result.metadata.error).toContain("Would exceed maximum sub_llm calls")
      expect(result.metadata.subLLMCalls).toBe(0)
    }),
  )

  it.instance("reports unknown sub-LLM agents without spawning a prompt", () =>
    Effect.gen(function* () {
      const result = yield* runRlm("return await sub_llm('work', 'missing-agent')")

      expect(result.title).toBe("RLM execution failed")
      expect(result.metadata.error).toContain("Unknown agent: missing-agent")
      expect(result.metadata.subLLMCalls).toBe(1)
    }),
  )
})
