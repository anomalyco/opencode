// [fork-only] friendlyErrorReply 单测 — A4 降级回复友好化
// [feat: feishu-bridge-newuser-onboarding] 2026-05-10

import { describe, expect, test } from "bun:test"
import { friendlyErrorReply } from "../message-pipeline"

describe("friendlyErrorReply — 把 opencode 技术错误翻译成 user 可操作指引", () => {
  test("'no providers found' → 引导去 Settings → Providers", () => {
    const out = friendlyErrorReply(new Error("no providers found"))
    expect(out).toContain("未配置默认 LLM model")
    expect(out).toContain("Settings → Providers")
    expect(out).toContain("(原始错误:no providers found)")
  })

  test("'no models found' → 同上", () => {
    const out = friendlyErrorReply(new Error("no models found"))
    expect(out).toContain("未配置默认 LLM model")
  })

  test("'Invalid model anthropic/foo. Model must be ...' → 同样识别为 model 配置问题", () => {
    const out = friendlyErrorReply(
      new Error('Invalid model anthropic/foo. Model must be in the format "provider/model".'),
    )
    expect(out).toContain("未配置默认 LLM model")
  })

  test("API key 类(401)→ key 无效提示", () => {
    const out = friendlyErrorReply(new Error("Request failed: 401 invalid API key"))
    expect(out).toContain("API key 可能无效")
    expect(out).toContain("Settings → Providers")
  })

  test("api_key 字段名(snake_case)同样识别", () => {
    const out = friendlyErrorReply(new Error("Bad request: api_key required"))
    expect(out).toContain("API key 可能无效")
  })

  test("非典型错误 → 保留原 message,不误伤", () => {
    const out = friendlyErrorReply(new Error("Network timeout after 30s"))
    expect(out).toContain("DeskFox 处理出错")
    expect(out).toContain("Network timeout after 30s")
    expect(out).not.toContain("LLM model")
    expect(out).not.toContain("API key 可能无效")
  })

  test("空 message → 保留默认 fallback", () => {
    const out = friendlyErrorReply(new Error(""))
    expect(out).toContain("DeskFox 处理出错")
  })
})
