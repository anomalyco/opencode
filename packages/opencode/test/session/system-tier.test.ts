import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { SystemPrompt } from "../../src/session/system"

import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_CODEX from "../../src/session/prompt/codex.txt"
import PROMPT_DEFAULT_COMPACT from "../../src/session/prompt/default-compact.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_KIMI from "../../src/session/prompt/kimi.txt"
import PROMPT_MINIMAL from "../../src/session/prompt/minimal.txt"

function model(id: string, extra?: Partial<Provider.Model>) {
  return { providerID: "test", api: { id }, ...extra } as Provider.Model
}

describe("session.system tier prompts", () => {
  test("minimal tier models get the minimal prompt", () => {
    expect(SystemPrompt.provider(model("qwen3.5-4b"))).toEqual([PROMPT_MINIMAL])
    expect(SystemPrompt.provider(model("llama-3.2-3b-instruct"))).toEqual([PROMPT_MINIMAL])
  })

  test("default tier models get the compact default prompt", () => {
    expect(SystemPrompt.provider(model("qwen3.6-35b-a3b"))).toEqual([PROMPT_DEFAULT_COMPACT])
    expect(SystemPrompt.provider(model("some-unknown-model"))).toEqual([PROMPT_DEFAULT_COMPACT])
  })

  test("frontier ladder output is byte-identical to the family prompts", () => {
    expect(SystemPrompt.provider(model("claude-sonnet-4-5"))).toEqual([PROMPT_ANTHROPIC])
    expect(SystemPrompt.provider(model("gpt-5.2"))).toEqual([PROMPT_GPT])
    expect(SystemPrompt.provider(model("gpt-5.2-codex"))).toEqual([PROMPT_CODEX])
    expect(SystemPrompt.provider(model("gpt-4.1"))).toEqual([PROMPT_BEAST])
    expect(SystemPrompt.provider(model("gemini-3-pro"))).toEqual([PROMPT_GEMINI])
    expect(SystemPrompt.provider(model("kimi-k2-thinking"))).toEqual([PROMPT_KIMI])
    expect(SystemPrompt.provider(model("k3", { providerID: "moonshotai" } as Partial<Provider.Model>))).toEqual([
      PROMPT_KIMI,
    ])
  })

  test("explicit per-model tier overrides the ladder", () => {
    expect(SystemPrompt.provider(model("claude-sonnet-4-5", { tier: "minimal" }))).toEqual([PROMPT_MINIMAL])
    expect(SystemPrompt.provider(model("qwen3.5-4b", { tier: "default" }))).toEqual([PROMPT_DEFAULT_COMPACT])
  })

  test("per-model prompt override replaces the family prompt entirely", () => {
    expect(SystemPrompt.provider(model("qwen3.5-4b", { prompt: "custom prompt" }))).toEqual(["custom prompt"])
    expect(SystemPrompt.provider(model("claude-sonnet-4-5", { prompt: "custom prompt" }))).toEqual(["custom prompt"])
  })
})
