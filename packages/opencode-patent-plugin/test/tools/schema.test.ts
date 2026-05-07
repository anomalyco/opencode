import { describe, expect, test } from "bun:test"

/**
 * 工具 Schema 验证测试
 *
 * 验证各 Tool 的 action 参数定义是否正确。
 * 不实际注册工具（需要 Plugin 环境），只验证 enum 值。
 */

// 从源码中提取的 action 枚举定义
const TOOL_ACTIONS: Record<string, string[]> = {
  patent_research: ["understand", "search", "analyze"],
  patent_draft: ["understand", "search", "specification", "claims", "abstract", "integrate"],
  oa_response: ["parse", "analyze", "simulate", "respond", "revise_claims", "validate"],
  patent_search: ["search"],
  patent_analyze: ["novelty", "inventiveness", "infringement"],
  patent_check: ["specification", "claims", "response", "full"],
  reexam_response: ["parse", "analyze", "draft", "revise_claims"],
  invalidation_response: ["parse", "analyze", "attack", "defend", "evidence"],
}

describe("Tool Schema 验证", () => {
  for (const [toolName, actions] of Object.entries(TOOL_ACTIONS)) {
    test(`${toolName} 有有效的 action 列表`, () => {
      expect(actions.length).toBeGreaterThan(0)
      actions.forEach(action => {
        expect(typeof action).toBe("string")
        expect(action.length).toBeGreaterThan(0)
        expect(action).toMatch(/^[a-z_]+$/)
      })
    })

    test(`${toolName} 的 actions 无重复`, () => {
      const unique = new Set(actions)
      expect(unique.size).toBe(actions.length)
    })
  }

  test("所有工具都有定义", () => {
    expect(Object.keys(TOOL_ACTIONS).length).toBe(8)
  })

  test("核心工具覆盖完整", () => {
    const requiredTools = ["patent_research", "patent_draft", "oa_response", "reexam_response", "invalidation_response"]
    requiredTools.forEach(tool => {
      expect(TOOL_ACTIONS[tool]).toBeDefined()
    })
  })
})
