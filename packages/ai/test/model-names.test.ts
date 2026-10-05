import { describe, expect, test } from "bun:test"
import { ModelNames } from "../src/model-names.js"

describe("ModelNames", () => {
  test("parses GPT versions consistently across hosted IDs and future generations", () => {
    for (const id of [
      "gpt-6.1-sol",
      "openai/gpt-6.1-sol",
      "openai-gpt-6-1-sol",
      "openai-gpt-61-sol",
      "global.openai.gpt-6.1-sol",
    ]) {
      expect(ModelNames.gptVersion(id)).toEqual({ major: 6, minor: 1 })
    }
    for (const id of ["gpt-7", "openai-gpt-7-sol", "openai/gpt-7-sol", "databricks-gpt-7-sol"]) {
      expect(ModelNames.gptVersion(id)).toEqual({ major: 7, minor: 0 })
    }
    expect(ModelNames.gptVersion("gpt-10.2-sol")).toEqual({ major: 10, minor: 2 })
    expect(ModelNames.gptVersion("openai-gpt-30-sol")).toEqual({ major: 30, minor: 0 })
    expect(ModelNames.gptVersion("openai-gpt-50-sol")).toEqual({ major: 50, minor: 0 })
    expect(ModelNames.gptVersion("gpt-7.100-sol")).toEqual({ major: 7, minor: 100 })
    expect(ModelNames.gptVersion("openai-gpt-54-mini")).toEqual({ major: 5, minor: 4 })
    expect(ModelNames.gptVersion("gpt-35-turbo")).toEqual({ major: 3, minor: 5 })
    expect(ModelNames.gptVersion("gpt-4o-mini")).toEqual({ major: 4, minor: 0 })
    expect(ModelNames.gptVersion("gpt-5-2025-08-07")).toEqual({ major: 5, minor: 0 })
    expect(ModelNames.gptVersion("gpt-oss-120b")).toBeUndefined()
    expect(ModelNames.gptVersion("qwen3.8-max")).toBeUndefined()
  })

  test("parses Claude legacy versions, gateway prefixes, snapshots, and future families", () => {
    for (const id of [
      "claude-opus-4-8",
      "anthropic-claude-opus-4.8",
      "anthropic/claude-opus-4.8",
      "us.anthropic.claude-opus-4-8-v1:0",
      "claude-4.8-opus",
      "anthropic--claude-4.8-opus",
      "opus-4.8",
    ]) {
      expect(ModelNames.claudeVersion(id)).toEqual({ family: "opus", major: 4, minor: 8 })
    }
    expect(ModelNames.claudeVersion("claude-sonnet-4-20250514")).toEqual({ family: "sonnet", major: 4, minor: 0 })
    expect(ModelNames.claudeVersion("claude-3-5-sonnet-20241022-v2:0")).toEqual({
      family: "sonnet",
      major: 3,
      minor: 5,
    })
    expect(ModelNames.claudeVersion("duo-chat-opus-5-5")).toEqual({ family: "opus", major: 5, minor: 5 })
    expect(ModelNames.claudeVersion("claude-opus4-8")).toEqual({ family: "opus", major: 4, minor: 8 })
    expect(ModelNames.claudeVersion("claude-orion-7.100")).toEqual({ family: "orion", major: 7, minor: 100 })
    expect(ModelNames.claudeVersion("claude-opus-latest")).toBeUndefined()
    expect(ModelNames.claudeVersion("Gemma-4-31B-Claude-4.6-Opus-Reasoning-Distilled")).toBeUndefined()
    expect(ModelNames.claudeVersion("kimi-k3")).toBeUndefined()
  })

  test("keeps default API selection separate from version detection", () => {
    for (const id of [
      "anthropic-claude-sonnet-5.5",
      "anthropic/claude-opus-4.8",
      "claude-orion-7",
      "claude-opus-latest",
    ]) {
      expect(ModelNames.isAnthropic(id)).toBe(true)
    }
    for (const id of ["openai-gpt-7-sol", "kimi-k3", "router:claude"]) {
      expect(ModelNames.isAnthropic(id)).toBe(false)
    }
  })
})
