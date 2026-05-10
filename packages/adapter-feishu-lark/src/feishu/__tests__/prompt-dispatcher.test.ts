// [fork-only] PromptDispatcher v2 单测
// [feat: feishu-bridge-completion-signal-rewire] 2026-05-10
//
// 覆盖 message.updated + time.completed 强完成信号路径,以及边界:
//   - first 新 assistant 锁定(后续 ghost 自动忽略)
//   - 锁定前到达的 parts 暂存 + 锁定时迁移
//   - synthetic / ignored / 非 text part 跳过
//   - error 路径
//   - timeout 兜底(有 captured 返 partial / 无 captured 返 no-message)
//   - 同 session 重复 register supersede
//   - session.error 直接 reject

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { PromptDispatcher } from "../prompt-dispatcher"

const SESSION = "ses_TEST"
const ASSISTANT_A = "msg_assistant_A"
const GHOST_B = "msg_ghost_B"
const PART_1 = "prt_1"
const PART_2 = "prt_2"

let dispatcher: PromptDispatcher

beforeEach(() => {
  dispatcher = new PromptDispatcher()
})
afterEach(() => {
  dispatcher.abortAll()
})

// fixture builders

const msgUpdated = (
  id: string,
  opts: { sessionID?: string; role?: string; completed?: number; error?: { message?: string } } = {},
) => ({
  type: "message.updated",
  properties: {
    info: {
      id,
      sessionID: opts.sessionID ?? SESSION,
      role: opts.role ?? "assistant",
      time: { created: 1, completed: opts.completed },
      ...(opts.error ? { error: opts.error } : {}),
    },
  },
})

const partUpdated = (
  partID: string,
  msgID: string,
  text: string,
  opts: { synthetic?: boolean; ignored?: boolean; type?: string; sessionID?: string } = {},
) => ({
  type: "message.part.updated",
  properties: {
    part: {
      id: partID,
      sessionID: opts.sessionID ?? SESSION,
      messageID: msgID,
      type: opts.type ?? "text",
      text,
      ...(opts.synthetic ? { synthetic: true } : {}),
      ...(opts.ignored ? { ignored: true } : {}),
    },
  },
})

// ============================================================
// happy path — first 新 assistant 完成 → resolve text
// ============================================================

describe("happy path", () => {
  test("part → message.updated(completed)→ resolve ok with text", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "你好"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "你好,我是 Claude"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 9999 }))
    const r = await p
    expect(r).toEqual({ kind: "ok", text: "你好,我是 Claude", messageID: ASSISTANT_A })
  })

  test("part 在 message.updated 之前到达 → 暂存后迁移成功", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    // parts arrive before any message.updated event captures the assistant
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "first"))
    dispatcher.dispatch(partUpdated(PART_2, ASSISTANT_A, "second"))
    // now message.updated comes with completion
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 100 }))
    const r = await p
    expect(r.kind).toBe("ok")
    if (r.kind === "ok") {
      expect(r.text).toBe("first\nsecond")
      expect(r.messageID).toBe(ASSISTANT_A)
    }
  })

  test("多 part 增量 update(cumulative text)→ 用最新值", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "abc"))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "abcdef"))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "abcdefghi"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 200 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("abcdefghi")
  })
})

// ============================================================
// ghost 抢占问题(本笔修复主场景)
// ============================================================

describe("ghost placeholder 不抢占", () => {
  test("锁定 A 后,B 的 message.updated/part 都被忽略,A.completed 触发 resolve", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "real reply"))
    // ghost B 试图来抢 — 应被忽略
    dispatcher.dispatch(msgUpdated(GHOST_B))
    dispatcher.dispatch(partUpdated(PART_2, GHOST_B, "")) // ghost 空文本
    // ghost B 立即 completed
    dispatcher.dispatch(msgUpdated(GHOST_B, { completed: 50 }))
    // A 的 completed 才应触发 resolve
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 300 }))
    const r = await p
    expect(r).toEqual({ kind: "ok", text: "real reply", messageID: ASSISTANT_A })
  })

  test("ghost 的 part(MSG_ID 不匹配)不污染 textBuffer", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "real"))
    dispatcher.dispatch(partUpdated("prt_ghost", GHOST_B, "should not appear"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 10 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("real")
  })
})

// ============================================================
// synthetic / ignored / 非 text part 跳过
// ============================================================

describe("非有效 part 跳过", () => {
  test("synthetic part 不计入", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "fake", { synthetic: true }))
    dispatcher.dispatch(partUpdated(PART_2, ASSISTANT_A, "real"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("real")
  })

  test("ignored part 不计入", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "skip", { ignored: true }))
    dispatcher.dispatch(partUpdated(PART_2, ASSISTANT_A, "keep"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("keep")
  })

  test("非 text type(reasoning / tool)part 不计入", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "thinking...", { type: "reasoning" }))
    dispatcher.dispatch(partUpdated(PART_2, ASSISTANT_A, "the answer"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("the answer")
  })
})

// ============================================================
// error 路径
// ============================================================

describe("error 路径", () => {
  test("info.error 在 completed 时被识别 → kind=error", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(
      msgUpdated(ASSISTANT_A, { completed: 1, error: { message: "rate limited" } }),
    )
    const r = await p
    expect(r).toEqual({
      kind: "error",
      error: { message: "rate limited" },
      messageID: ASSISTANT_A,
    })
  })

  test("session.error 事件 → reject", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch({
      type: "session.error",
      properties: { sessionID: SESSION, error: { message: "auth fail" } },
    })
    await expect(p).rejects.toThrow("auth fail")
  })
})

// ============================================================
// timeout 兜底 — 事件丢失场景
// ============================================================

describe("timeout 兜底", () => {
  test("timeout 时已捕获 assistant + 有 partial text → resolve ok with partial", async () => {
    const p = dispatcher.register(SESSION, 50)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "partial..."))
    // 不发 completed,等 timeout
    const r = await p
    expect(r.kind).toBe("ok")
    if (r.kind === "ok") {
      expect(r.text).toBe("partial...")
      expect(r.messageID).toBe(ASSISTANT_A)
    }
  })

  test("timeout 时未捕获任何 assistant → resolve no-message", async () => {
    const p = dispatcher.register(SESSION, 50)
    // 啥都不 dispatch
    const r = await p
    expect(r.kind).toBe("no-message")
  })
})

// ============================================================
// session 串扰防御
// ============================================================

describe("session 隔离", () => {
  test("不同 sessionID 的 message.updated 不影响本 waiter", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { sessionID: "ses_OTHER", completed: 1 }))
    // 本 session 还在等
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "mine"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p
    expect(r.kind === "ok" && r.text).toBe("mine")
  })

  test("同 sessionID 重复 register → 旧 reject(superseded)", async () => {
    const p1 = dispatcher.register(SESSION, 60_000)
    const p2 = dispatcher.register(SESSION, 60_000)
    await expect(p1).rejects.toThrow("superseded")
    // p2 仍在等;让它正常完成
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "v2"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p2
    expect(r.kind === "ok" && r.text).toBe("v2")
  })

  test("user role message.updated 被忽略(不锁定为 capturedAssistantID)", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.dispatch(msgUpdated("msg_user", { role: "user" }))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(partUpdated(PART_1, ASSISTANT_A, "answer"))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    const r = await p
    expect(r.kind === "ok" && r.messageID).toBe(ASSISTANT_A)
  })
})

// ============================================================
// pending count + abort
// ============================================================

describe("生命周期", () => {
  test("pending 反映 active waiter 数,resolve 后归 0", async () => {
    expect(dispatcher.pending).toBe(0)
    const p = dispatcher.register(SESSION, 60_000)
    expect(dispatcher.pending).toBe(1)
    dispatcher.dispatch(msgUpdated(ASSISTANT_A))
    dispatcher.dispatch(msgUpdated(ASSISTANT_A, { completed: 1 }))
    await p
    expect(dispatcher.pending).toBe(0)
  })

  test("abortAll 拒绝所有 pending waiter", async () => {
    const p = dispatcher.register(SESSION, 60_000)
    dispatcher.abortAll()
    await expect(p).rejects.toThrow("aborted")
    expect(dispatcher.pending).toBe(0)
  })
})
