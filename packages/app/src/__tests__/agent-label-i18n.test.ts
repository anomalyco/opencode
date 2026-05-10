import { describe, expect, test } from "bun:test"
import { dict as en } from "../i18n/en"
import { dict as zh } from "../i18n/zh"

/** 模拟 agentLabel 函数的字典查找行为，与 prompt-input.tsx 中逻辑一致 */
const agentLabel = (dict: Record<string, string>, name: string) => {
  const key = `agent.name.${name}` as keyof typeof dict
  return dict[key] ?? name
}

const BUILTIN_AGENTS = ["build", "plan", "general", "explore", "scout"] as const

describe("agent label i18n", () => {
  test('agentLabel("build") returns "Build" in English', () => {
    expect(agentLabel(en, "build")).toBe("Build")
  })

  test('agentLabel("plan") returns "Plan" in English', () => {
    expect(agentLabel(en, "plan")).toBe("Plan")
  })

  test("agentLabel returns correct English labels for all 5 built-in agents", () => {
    expect(agentLabel(en, "build")).toBe("Build")
    expect(agentLabel(en, "plan")).toBe("Plan")
    expect(agentLabel(en, "general")).toBe("General")
    expect(agentLabel(en, "explore")).toBe("Explore")
    expect(agentLabel(en, "scout")).toBe("Scout")
  })

  test("agentLabel returns correct Chinese labels for all 5 built-in agents", () => {
    expect(agentLabel(zh, "build")).toBe("构建")
    expect(agentLabel(zh, "plan")).toBe("规划")
    expect(agentLabel(zh, "general")).toBe("通用")
    expect(agentLabel(zh, "explore")).toBe("探索")
    expect(agentLabel(zh, "scout")).toBe("侦察")
  })

  test("all 5 built-in agent i18n keys exist in English dictionary", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(en[`agent.name.${agent}`]).toBeDefined()
      expect(typeof en[`agent.name.${agent}`]).toBe("string")
    }
  })

  test("all 5 built-in agent i18n keys exist in Chinese dictionary", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(zh[`agent.name.${agent}`]).toBeDefined()
      expect(typeof zh[`agent.name.${agent}`]).toBe("string")
    }
  })

  test("unknown agent name falls back to original name", () => {
    expect(agentLabel(en, "unknown-agent")).toBe("unknown-agent")
    expect(agentLabel(zh, "unknown-agent")).toBe("unknown-agent")
    expect(agentLabel(en, "custom-built-agent")).toBe("custom-built-agent")
    expect(agentLabel(zh, "custom-built-agent")).toBe("custom-built-agent")
  })

  test("Chinese agent name translations are non-empty and differ from English", () => {
    for (const agent of BUILTIN_AGENTS) {
      const enValue = en[`agent.name.${agent}`]
      const zhValue = zh[`agent.name.${agent}`]
      expect(zhValue).toBeDefined()
      expect(zhValue.length).toBeGreaterThan(0)
      expect(zhValue).not.toBe(enValue)
    }
  })
})
