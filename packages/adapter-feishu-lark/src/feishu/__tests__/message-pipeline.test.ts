// [fork-only] message-pipeline helper 单测 — findLastUsefulAssistant
// [feat: feishu-bridge-empty-reply-ghost] 2026-05-10
// [bug-repro: opencode agent loop 尾部 0-token 空 placeholder ghost 抢占 last assistant
//  → plugin 倒序取错 → 飞书没回复(本案 5 条丢失中 4 条由此 case 触发)]
//
// 单测覆盖 8 个场景,纯函数,跨平台一致。

import { describe, expect, test } from "bun:test"
import { findLastUsefulAssistant, type AssistantMessageEntry } from "../message-pipeline"

// ============================================================
// fixture builders
// ============================================================

function userMsg(): AssistantMessageEntry {
  return { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }
}

function realReply(text: string): AssistantMessageEntry {
  return {
    info: { role: "assistant" },
    parts: [
      { type: "step-start" },
      { type: "text", text },
      { type: "step-finish" },
    ],
  }
}

function ghost(): AssistantMessageEntry {
  return {
    info: { role: "assistant" },
    parts: [
      { type: "step-start" },
      { type: "text", text: "" },
      { type: "step-finish" },
    ],
  }
}

function erroredReply(message: string): AssistantMessageEntry {
  return {
    info: { role: "assistant", error: { message } },
    parts: [{ type: "step-start" }, { type: "step-finish" }],
  }
}

// ============================================================
// happy path — 短 reply 无 ghost 跟随
// ============================================================

describe("happy path", () => {
  test("[user, realReply] → 命中 realReply", () => {
    const r = findLastUsefulAssistant([userMsg(), realReply("你好！我是 Claude")])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("你好！我是 Claude")
  })

  test("空数组 → undefined", () => {
    expect(findLastUsefulAssistant([])).toBeUndefined()
  })

  test("只有 user role,无 assistant → undefined", () => {
    expect(findLastUsefulAssistant([userMsg(), userMsg()])).toBeUndefined()
  })
})

// ============================================================
// 主修场景 — placeholder ghost 在尾部
// ============================================================

describe("placeholder ghost 跳过", () => {
  test("[user, realReply, ghost] → 跳过 ghost,命中 realReply(本笔修复主场景)", () => {
    const r = findLastUsefulAssistant([userMsg(), realReply("分支共 6 个..."), ghost()])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("分支共 6 个...")
  })

  test("[user, realReply, ghost, ghost] 多个连续 ghost → 全跳过,命中 realReply", () => {
    const r = findLastUsefulAssistant([userMsg(), realReply("answer"), ghost(), ghost()])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("answer")
  })

  test("整段全是 ghost → undefined", () => {
    expect(findLastUsefulAssistant([userMsg(), ghost(), ghost()])).toBeUndefined()
  })

  test("text part 只有空白字符(空格/换行)→ 视为 ghost 跳过", () => {
    const whitespaceGhost: AssistantMessageEntry = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "   \n\t  " }],
    }
    const r = findLastUsefulAssistant([userMsg(), realReply("real"), whitespaceGhost])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("real")
  })
})

// ============================================================
// error 路径 — error 视为有用,caller 会抛出去
// ============================================================

describe("error 优先返回", () => {
  test("[user, errored] → 命中 errored(无 text 但有 error)", () => {
    const r = findLastUsefulAssistant([userMsg(), erroredReply("rate limit")])
    expect(r?.info.error?.message).toBe("rate limit")
  })

  test("[user, realReply, errored, ghost] → 命中 errored(error 优先于跳过 ghost)", () => {
    const r = findLastUsefulAssistant([
      userMsg(),
      realReply("旧"),
      erroredReply("new error"),
      ghost(),
    ])
    expect(r?.info.error?.message).toBe("new error")
  })
})

// ============================================================
// synthetic / ignored part 不算有效 text
// ============================================================

describe("synthetic / ignored 跳过", () => {
  test("text part 标 synthetic=true → 不算有效 text(plugin 不应转发 prompt-injection 类合成内容)", () => {
    const synthOnly: AssistantMessageEntry = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "synthetic text", synthetic: true }],
    }
    expect(findLastUsefulAssistant([userMsg(), synthOnly])).toBeUndefined()
  })

  test("text part 标 ignored=true → 不算有效 text", () => {
    const ignOnly: AssistantMessageEntry = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "ignored", ignored: true }],
    }
    expect(findLastUsefulAssistant([userMsg(), ignOnly])).toBeUndefined()
  })

  test("混合 synthetic(空) + 真 text(非空)→ 命中(真 text 满足条件即可)", () => {
    const mixed: AssistantMessageEntry = {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "fake", synthetic: true },
        { type: "text", text: "real" },
      ],
    }
    const r = findLastUsefulAssistant([userMsg(), mixed])
    expect(r).toBe(mixed)
  })
})

// ============================================================
// 历史多轮 — 不能跳过当前轮的 placeholder 取上一轮的真 reply
// ============================================================

describe("历史多轮稳定性", () => {
  test("[u1, r1, u2, ghost] → 跳过 ghost 后找到 r1(本案当前已知行为 — Bug C 在 Layer 2 修)", () => {
    // 注:理想情况下应该返 undefined(当前轮没真 reply),但本 helper 不识别"轮"边界,
    // 倒序找到 r1 就停。chatQueue 串行保证不会出现 [u1, r1, u2, in-flight] 然后 plugin
    // 误把 r1 发给 u2 的场景 — 因为 u2 必须等 u1 reply 完整 sent 才入队。
    // 所以这个 case 只会在 timeout 兜底时触发,接受跨轮取值作为 fallback。
    const r = findLastUsefulAssistant([userMsg(), realReply("r1"), userMsg(), ghost()])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("r1")
  })
})
