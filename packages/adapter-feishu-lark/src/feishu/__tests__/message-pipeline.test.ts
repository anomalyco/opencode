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
  test("无 userMsgId 时退化跨轮 fallback(向后兼容)— [u1, r1, u2, ghost] → r1", () => {
    // 兼容性 case:不传 userMsgId 时,helper 退化成"任何轮"行为
    const r = findLastUsefulAssistant([userMsg(), realReply("r1"), userMsg(), ghost()])
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("r1")
  })
})

// ============================================================
// 本轮 parentID 约束(2026-05-11 加,修 reject 后回退取前轮答案的 bug)
// ============================================================

function userMsgWithId(id: string, text = "hello"): AssistantMessageEntry {
  return { info: { id, role: "user" }, parts: [{ type: "text", text }] }
}

function replyWithParent(parentID: string, text: string): AssistantMessageEntry {
  return {
    info: { role: "assistant", parentID },
    parts: [
      { type: "step-start" },
      { type: "text", text },
      { type: "step-finish" },
    ],
  }
}

function ghostWithParent(parentID: string): AssistantMessageEntry {
  return {
    info: { role: "assistant", parentID },
    parts: [
      { type: "step-start" },
      { type: "text", text: "" },
      { type: "step-finish" },
    ],
  }
}

describe("本轮 parentID 约束", () => {
  test("[u1, r1(parent=u1), u2, ghost(parent=u2)] + userMsgId=u2 → undefined(本轮无真 reply)", () => {
    // 修 bug:之前返 r1(跨轮取上一轮答案 → reject 时回放旧答到飞书严重 UX 问题)
    const data = [
      userMsgWithId("u1"),
      replyWithParent("u1", "r1 上一轮答案"),
      userMsgWithId("u2"),
      ghostWithParent("u2"),
    ]
    expect(findLastUsefulAssistant(data, "u2")).toBeUndefined()
  })

  test("[u1, r1(parent=u1), u2, r2(parent=u2)] + userMsgId=u2 → r2", () => {
    const data = [
      userMsgWithId("u1"),
      replyWithParent("u1", "r1 旧答案"),
      userMsgWithId("u2"),
      replyWithParent("u2", "r2 新答案"),
    ]
    const r = findLastUsefulAssistant(data, "u2")
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("r2 新答案")
  })

  test("[u1, r1, u2, ghost(parent=u2), r2_real(parent=u2)] + userMsgId=u2 → r2_real(跳 ghost,锁本轮)", () => {
    const data = [
      userMsgWithId("u1"),
      replyWithParent("u1", "r1"),
      userMsgWithId("u2"),
      ghostWithParent("u2"),
      replyWithParent("u2", "r2 真答案"),
    ]
    // 注:实际 opencode 数据 ghost 跟在 real 之后,这测的是"r2 在 ghost 之前"的逆序 case;
    // 主修场景见下个测试
    const r = findLastUsefulAssistant(data, "u2")
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("r2 真答案")
  })

  test("[u1, r1, u2, r2_real(parent=u2), ghost(parent=u2)] + userMsgId=u2 → r2_real(主修场景:ghost 跟在 real 后)", () => {
    const data = [
      userMsgWithId("u1"),
      replyWithParent("u1", "r1"),
      userMsgWithId("u2"),
      replyWithParent("u2", "r2 真答案"),
      ghostWithParent("u2"),
    ]
    const r = findLastUsefulAssistant(data, "u2")
    expect(r?.parts.find((p) => p.type === "text")?.text).toBe("r2 真答案")
  })

  test("当前轮 reject 路径(LLM 无 text + 无 info.error)+ userMsgId 限定 → undefined(关键修)", () => {
    // 模拟 reject 后 LLM 没产生新 text:本轮 assistant 是 ghost shape,info.error 没设
    // (RejectedError 在 part state 不在 info)
    const data = [
      userMsgWithId("u1", "请帮我看 .md 文件"),
      replyWithParent("u1", "共 35 个 .md 文件:..."),  // 上一轮真答案
      userMsgWithId("u2", "读 hosts 文件"),
      ghostWithParent("u2"),  // 本轮被 reject,没真 text
    ]
    // 修前:没传 userMsgId → 倒序回退到 r1 → 误把上一轮答案发给本轮 user
    expect(findLastUsefulAssistant(data)?.parts.find((p) => p.type === "text")?.text).toBe(
      "共 35 个 .md 文件:...",  // 兼容性 — 不传 userMsgId 仍跨轮 fallback
    )
    // 修后:传 userMsgId=u2 → 锁本轮 → 没 useful assistant → 返 undefined
    expect(findLastUsefulAssistant(data, "u2")).toBeUndefined()
  })

  test("本轮 assistant 有 error → 返(error 也算 useful,caller 抛出去)", () => {
    const erroredWithParent = (parentID: string, message: string): AssistantMessageEntry => ({
      info: { role: "assistant", parentID, error: { message } },
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    const data = [
      userMsgWithId("u1"),
      replyWithParent("u1", "r1"),
      userMsgWithId("u2"),
      erroredWithParent("u2", "rate limit"),
    ]
    const r = findLastUsefulAssistant(data, "u2")
    expect(r?.info.error?.message).toBe("rate limit")
  })

  test("userMsgId 不存在于 data → undefined(防御:userMsgId 找不到时不要误取)", () => {
    const data = [userMsgWithId("u1"), replyWithParent("u1", "r1")]
    expect(findLastUsefulAssistant(data, "u_nonexistent")).toBeUndefined()
  })
})
