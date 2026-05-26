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
})