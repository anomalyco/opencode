import { describe, expect, test } from "bun:test"

describe("Patent Integration", () => {
  test("patent-draft prompt exists and contains key terms", async () => {
    const prompt = await import("../../src/agent/prompt/patent-draft.txt")
    expect(prompt.default).toBeDefined()
    expect(prompt.default).toContain("专利代理师")
  })

  test("patent-oa prompt exists and contains key terms", async () => {
    const prompt = await import("../../src/agent/prompt/patent-oa.txt")
    expect(prompt.default).toBeDefined()
    expect(prompt.default).toContain("审查意见")
  })

  test("patent-creativity prompt exists and contains key terms", async () => {
    const prompt = await import("../../src/agent/prompt/patent-creativity.txt")
    expect(prompt.default).toBeDefined()
    expect(prompt.default).toContain("三步法")
    expect(prompt.default).toContain("创造性")
  })

  test("patent-reexam prompt exists and contains key terms", async () => {
    const prompt = await import("../../src/agent/prompt/patent-reexam.txt")
    expect(prompt.default).toBeDefined()
    expect(prompt.default).toContain("复审")
    expect(prompt.default).toContain("驳回")
  })

  test("patent-invalidation prompt exists and contains key terms", async () => {
    const prompt = await import("../../src/agent/prompt/patent-invalidation.txt")
    expect(prompt.default).toBeDefined()
    expect(prompt.default).toContain("无效宣告")
    expect(prompt.default).toContain("对比文件")
  })
})