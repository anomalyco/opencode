import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { PatentQuality } from "@/patent/quality"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { testEffect } from "../lib/effect"
import { PatentCheckTool } from "@/tool/patent-check"

const mockQualityReport: PatentQuality.CheckReport = {
  totalScore: 8.5,
  passed: true,
  summary: "文档质量良好",
  scores: [
    { name: "完整性", score: 9.0, weight: 0.2, issues: [] },
    { name: "清晰性", score: 8.5, weight: 0.2, issues: [] },
    { name: "准确性", score: 8.0, weight: 0.2, issues: [] },
    { name: "充分性", score: 8.5, weight: 0.15, issues: [] },
    { name: "一致性", score: 9.0, weight: 0.15, issues: [] },
    { name: "规范性", score: 8.5, weight: 0.05, issues: [] },
    { name: "支持性", score: 8.0, weight: 0.05, issues: [] },
  ],
  suggestions: ["建议补充技术背景说明"],
}

const mockQualityLayer = Layer.succeed(
  PatentQuality.Service,
  PatentQuality.Service.of({
    check: Effect.fn("mock.check")(() => Effect.succeed(mockQualityReport)),
    autoFix: Effect.fn("mock.autoFix")(() => Effect.succeed("修复后的文档内容...")),
  }),
)

const mockTruncateLayer = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: Effect.fn("mock.cleanup")(() => Effect.void),
    write: Effect.fn("mock.write")(() => Effect.succeed("/mock/path")),
    output: Effect.fn("mock.output")((text: string) => Effect.succeed({ content: text, truncated: false })),
    limits: Effect.fn("mock.limits")(() => Effect.succeed({ maxLines: 2000, maxBytes: 51200 })),
  }),
)

const mockAgentLayer = Layer.succeed(
  Agent.Service,
  Agent.Service.of({
    list: Effect.fn("mock.list")(() => Effect.succeed({})),
    get: Effect.fn("mock.get")((id: string) => Effect.succeed({ id, name: id, permission: null })),
    create: Effect.fn("mock.create")(() => Effect.succeed({ id: "test", name: "test", permission: null })),
    update: Effect.fn("mock.update")(() => Effect.void),
    remove: Effect.fn("mock.remove")(() => Effect.void),
  }),
)

const it = testEffect(Layer.mergeAll(mockQualityLayer, mockTruncateLayer, mockAgentLayer))

describe("PatentCheckTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-check")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentCheckTool).toBeDefined()
    expect(mod.PatentCheckTool.id).toBe("patent_check")
  })

  it.effect("execute returns check report", () =>
    Effect.gen(function* () {
      const toolInfo = yield* PatentCheckTool
      const toolDef = yield* toolInfo.init()

      const result = yield* toolDef.execute(
        {
          document_type: "specification",
          content: "这是一个测试文档内容",
          auto_fix: false,
        },
        {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "test-agent",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.title).toContain("质量检查")
      expect(result.output).toContain("总体评分: 8.5/10")
      expect(result.output).toContain("✓ 通过")
      expect(result.metadata.totalScore).toBe(8.5)
      expect(result.metadata.passed).toBe(true)
      expect(result.metadata.autoFixed).toBe(false)
    }),
  )
})