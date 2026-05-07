import { describe, expect, test } from "bun:test"
import { extractPatentKeywords } from "../../src/utils/patent-keywords.js"

describe("extractPatentKeywords", () => {
  test("提取审查意见中的术语", () => {
    const text = "本发明具备创造性，且具有新颖性。审查员认为技术启示明显。"
    const keywords = extractPatentKeywords(text)
    expect(keywords).toContain("创造性")
    expect(keywords).toContain("新颖性")
    expect(keywords).toContain("技术启示")
  })

  test("maxKeywords 截断", () => {
    const text = "创造性 新颖性 实用性 公开不充分 不清楚 超范围 独立权利要求 从属权利要求"
    const keywords = extractPatentKeywords(text, 3)
    expect(keywords.length).toBeLessThanOrEqual(3)
  })

  test("空输入返回空数组", () => {
    expect(extractPatentKeywords("")).toEqual([])
  })

  test("无匹配返回空数组", () => {
    expect(extractPatentKeywords("这是一段普通文本")).toEqual([])
  })

  test("重复术语去重", () => {
    const text = "创造性很重要，创造性是关键"
    const keywords = extractPatentKeywords(text)
    const creativityCount = keywords.filter(k => k === "创造性").length
    expect(creativityCount).toBe(1)
  })
})
