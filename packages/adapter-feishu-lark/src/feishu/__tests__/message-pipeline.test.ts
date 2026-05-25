// [fork-only] message-pipeline helper 单测 — findLastUsefulAssistant
// [feat: feishu-bridge-empty-reply-ghost] 2026-05-10
// [bug-repro: opencode agent loop 尾部 0-token 空 placeholder ghost 抢占 last assistant
//  → plugin 倒序取错 → 飞书没回复(本案 5 条丢失中 4 条由此 case 触发)]
//
// 单测覆盖 8 个场景,纯函数,跨平台一致。

import { describe, expect, test } from "bun:test"
import type { FeishuAccount } from "../../core/config-schema"
import { ChatSessionStore } from "../chat-session-store"
import {
  findLastUsefulAssistant,
  MessagePipeline,
  type AssistantMessageEntry,
} from "../message-pipeline"
import { PromptDispatcher } from "../prompt-dispatcher"
import type { ImMessageEvent } from "../wss-client"

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

// ============================================================
// /new slash command 集成测 (feat: feishu-bridge-light)
// ============================================================

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "bun:test"

interface SentText {
  chatId: string
  text: string
}

function makeNewCmdFakes() {
  const sentTexts: SentText[] = []
  const ackedMessages: string[] = []

  const larkClient = {
    im: {
      v1: {
        message: {
          create: async (args: any) => {
            const content = JSON.parse(args.data.content)
            sentTexts.push({ chatId: args.data.receive_id, text: content.text })
            return { data: { message_id: "om_fake" } }
          },
        },
        messageReaction: {
          create: async (args: any) => {
            ackedMessages.push(args.path.message_id)
            return { data: {} }
          },
        },
      },
    },
  } as any

  // /new path 不调 opencode,提供最小空 stub
  const opencodeClient = {
    session: {
      create: async () => ({ data: { id: "ses_should_not_be_called" } }),
      messages: async () => ({ data: [] }),
      promptAsync: async () => ({ data: {} }),
    },
  } as any

  return { sentTexts, ackedMessages, larkClient, opencodeClient }
}

function makeAccount(overrides: Partial<FeishuAccount> = {}): FeishuAccount {
  return {
    appId: "test_app",
    appSecret: { type: "plaintext", value: "test_secret" },
    domain: "feishu",
    agent: "build",
    ...overrides,
  } as FeishuAccount
}

function makeEvent(overrides: Partial<ImMessageEvent> = {}): ImMessageEvent {
  return {
    accountId: "acc1",
    messageId: "om_test_1",
    chatId: "oc_chat_x",
    chatType: "p2p",
    messageType: "text",
    content: JSON.stringify({ text: "/new" }),
    senderOpenId: "ou_sender",
    ts: String(Date.now()),
    mentions: [],
    ...overrides,
  }
}

describe("/new slash command (feat: feishu-bridge-light)", () => {
  let tmpDir: string
  let store: ChatSessionStore
  let dispatcher: PromptDispatcher
  let fakes: ReturnType<typeof makeNewCmdFakes>
  let pipeline: MessagePipeline

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msg-pipeline-test-"))
    store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    dispatcher = new PromptDispatcher()
    fakes = makeNewCmdFakes()
    pipeline = new MessagePipeline({
      account: makeAccount(),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
    })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("私聊 /new → 清 session + 发确认消息", async () => {
    // 准备:先在 store 里有 session 映射
    store.set("acc1", "oc_chat_x", "ses_old")
    expect(store.get("acc1", "oc_chat_x")).toBe("ses_old")

    await pipeline.testHandle(makeEvent({ content: JSON.stringify({ text: "/new" }) }))

    // 断言 disk 已清
    expect(store.get("acc1", "oc_chat_x")).toBeUndefined()
    // 断言飞书收到确认文字
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.chatId).toBe("oc_chat_x")
    expect(fakes.sentTexts[0]!.text).toBe("✅ 已开启新对话")
    // /new 早退,不应触发 ack(ackMessage 在 /new 分支之后才执行)
    expect(fakes.ackedMessages).toHaveLength(0)
  })

  test("私聊 @bot /new → strip mention 后识别,清 session", async () => {
    store.set("acc1", "oc_chat_x", "ses_old")
    await pipeline.testHandle(
      makeEvent({
        content: JSON.stringify({ text: "@_user_1 /new" }),
        mentions: [{ key: "_user_1", name: "bot", openId: "ou_bot" }],
      }),
    )
    expect(store.get("acc1", "oc_chat_x")).toBeUndefined()
    expect(fakes.sentTexts[0]!.text).toBe("✅ 已开启新对话")
  })

  test("群聊 /new → 拒绝,session 不清", async () => {
    store.set("acc1", "oc_chat_x", "ses_old")
    await pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "/new" }),
      }),
    )
    // session 应保留
    expect(store.get("acc1", "oc_chat_x")).toBe("ses_old")
    // 提示文字
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("/new 仅支持私聊")
  })

  test("私聊 /new 无原 session(冷启)→ 也发确认,不抛", async () => {
    expect(store.get("acc1", "oc_chat_x")).toBeUndefined()
    await pipeline.testHandle(makeEvent({ content: JSON.stringify({ text: "/new" }) }))
    expect(fakes.sentTexts[0]!.text).toBe("✅ 已开启新对话")
  })

  test("私聊普通消息(非 /new)→ 不走 /new 分支(走正常流程,会触发 ack)", async () => {
    // 不准备 session;普通消息会进 opencode 流程,但本测试只验未走 /new 早退
    // 不等正常流程完成(opencode stub 不实现 promptAsync resolve),只验早期行为
    void pipeline.testHandle(makeEvent({ content: JSON.stringify({ text: "你好" }) }))
    // 给 ack fire-and-forget 一点时间
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
    // 普通消息不发"已开启新对话"
    expect(fakes.sentTexts.find((s) => s.text.includes("已开启新对话"))).toBeUndefined()
  })
})

// ============================================================
// /group slash command + 自然语言引导
// [feat: feishu-group-slash-command] 2026-05-24
// ============================================================

describe("/group slash command (feat: feishu-group-slash-command)", () => {
  let tmpDir: string
  let store: ChatSessionStore
  let dispatcher: PromptDispatcher
  let fakes: ReturnType<typeof makeNewCmdFakes>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "group-cmd-test-"))
    store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    dispatcher = new PromptDispatcher()
    fakes = makeNewCmdFakes()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makePipeline(): MessagePipeline {
    return new MessagePipeline({
      account: makeAccount(),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
    })
  }

  test("p2p + /group 项目讨论 → 发 confirm card,不调 LLM,不触发 ack", async () => {
    const pipeline = makePipeline()
    let promptAsyncCalled = false
    fakes.opencodeClient.session.promptAsync = async () => {
      promptAsyncCalled = true
      return { data: {} } as any
    }
    await pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: "/group 项目讨论" }) }),
    )
    await new Promise((r) => setTimeout(r, 50))

    expect(promptAsyncCalled).toBe(false)
    // confirm card 不在 sentTexts 中(走 interactive msg_type)
    expect(fakes.sentTexts.find((s) => s.text?.includes("仅支持私聊"))).toBeUndefined()
    expect(fakes.sentTexts.find((s) => s.text?.includes("用法:"))).toBeUndefined()
    expect(fakes.ackedMessages).toHaveLength(0)
  })

  test("p2p + /group(无参数)→ reply 用法提示", async () => {
    const pipeline = makePipeline()
    await pipeline.testHandle(makeEvent({ content: JSON.stringify({ text: "/group" }) }))
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("用法")
    expect(fakes.sentTexts[0]!.text).toContain("/group <群名>")
    expect(fakes.sentTexts[0]!.text).toContain("项目讨论")
  })

  test("p2p + /group <31字符长名> → reply 超长拒绝", async () => {
    const pipeline = makePipeline()
    const longName = "a".repeat(31)
    await pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: `/group ${longName}` }) }),
    )
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("超长")
    expect(fakes.sentTexts[0]!.text).toContain("30")
  })

  test("群聊 + /group X → reply 仅支持私聊", async () => {
    const pipeline = makePipeline()
    await pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "/group 项目讨论" }),
      }),
    )
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("仅支持私聊")
  })

  test("p2p + 自然语言'帮我建群' → reply 引导用 /group,不调 LLM", async () => {
    const pipeline = makePipeline()
    let promptAsyncCalled = false
    fakes.opencodeClient.session.promptAsync = async () => {
      promptAsyncCalled = true
      return { data: {} } as any
    }
    await pipeline.testHandle(makeEvent({ content: JSON.stringify({ text: "帮我建群" }) }))

    expect(promptAsyncCalled).toBe(false)
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("/group <群名>")
    expect(fakes.sentTexts[0]!.text).toContain("项目讨论")
    expect(fakes.ackedMessages).toHaveLength(0)
  })

  test("p2p + '建群怎么操作'(查询后缀)→ 不拦截,走 LLM", async () => {
    const pipeline = makePipeline()
    void pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: "建群怎么操作" }) }),
    )
    await new Promise((r) => setTimeout(r, 50))
    // 查询后缀排除 → 走正常 LLM 流程 → 触发 ack
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
    expect(fakes.sentTexts.find((s) => s.text?.includes("/group <群名>"))).toBeUndefined()
  })

  test("p2p + '建立群体精神'(不在白名单)→ 不拦截,走 LLM", async () => {
    const pipeline = makePipeline()
    void pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: "建立群体精神" }) }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
    expect(fakes.sentTexts.find((s) => s.text?.includes("/group <群名>"))).toBeUndefined()
  })

  test("群聊 + '帮我建群' → 不拦截(p2p gate),走 LLM", async () => {
    const pipeline = makePipeline()
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "帮我建群" }),
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
    expect(fakes.sentTexts.find((s) => s.text?.includes("/group"))).toBeUndefined()
  })

  test("p2p + '@bot 帮我建群' → strip mention 后命中,走 /group 引导", async () => {
    const pipeline = makePipeline()
    // 用 Tier 1 短语"建群"避免撞已知漏拦"建一个X群"
    await pipeline.testHandle(
      makeEvent({
        content: JSON.stringify({ text: "@_user_1 帮我建群" }),
        mentions: [{ key: "_user_1", name: "bot", openId: "ou_bot" }],
      }),
    )
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("/group <群名>")
  })

  test("p2p + 'create a group for us' → 英文命中,走 /group 引导", async () => {
    const pipeline = makePipeline()
    await pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: "create a group for us" }) }),
    )
    expect(fakes.sentTexts).toHaveLength(1)
    expect(fakes.sentTexts[0]!.text).toContain("/group <群名>")
  })

  test("p2p + 'new group rule'(noun phrase 排除)→ 不拦截,走 LLM", async () => {
    const pipeline = makePipeline()
    void pipeline.testHandle(
      makeEvent({ content: JSON.stringify({ text: "what is the new group rule" }) }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
    expect(fakes.sentTexts.find((s) => s.text?.includes("/group <群名>"))).toBeUndefined()
  })
})

// ============================================================
// 群消息 requireMention enforcement (feat: feishu-group-mention-policy)
// 2026-05-24
// ============================================================

describe("requireMention enforcement (feat: feishu-group-mention-policy)", () => {
  let tmpDir: string
  let store: ChatSessionStore
  let dispatcher: PromptDispatcher
  let fakes: ReturnType<typeof makeNewCmdFakes>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mention-policy-test-"))
    store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    dispatcher = new PromptDispatcher()
    fakes = makeNewCmdFakes()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makePipeline(opts: {
    requireMention: boolean
    botName?: string
  }): MessagePipeline {
    return new MessagePipeline({
      account: makeAccount({
        requireMention: opts.requireMention,
        botName: opts.botName ?? "DeskFox-Mac",
      } as any),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
    })
  }

  test("group + requireMention=true + bot 没被 @(只 @ alice)→ 早退,0 promptAsync 0 ack", async () => {
    const pipeline = makePipeline({ requireMention: true })
    let promptAsyncCalled = false
    fakes.opencodeClient.session.promptAsync = async () => {
      promptAsyncCalled = true
      return { data: {} } as any
    }
    await pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "大家好" }),
        mentions: [{ key: "_user_1", name: "alice", openId: "ou_alice" }], // @ alice 不是 bot
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(promptAsyncCalled).toBe(false)
    expect(fakes.ackedMessages).toHaveLength(0)
    expect(fakes.sentTexts).toHaveLength(0)
  })

  test("group + requireMention=true + bot 被 @(mention.name = botName)→ 正常流程(ack 触发)", async () => {
    const pipeline = makePipeline({ requireMention: true, botName: "DeskFox-Mac" })
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "@_user_1 你好" }),
        // mention.name 匹配 botName → bot 被 @
        mentions: [{ key: "_user_1", name: "DeskFox-Mac", openId: "ou_bot_actual" }],
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  test("group + requireMention=false + bot 没被 @ → 正常流程(免 @ 直接响应)", async () => {
    const pipeline = makePipeline({ requireMention: false })
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "大家好" }),
        mentions: [],
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  test("group + requireMention=false + bot 被 @ → 也正常响应(不重复触发)", async () => {
    const pipeline = makePipeline({ requireMention: false, botName: "DeskFox-Mac" })
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "@_user_1 你好" }),
        mentions: [{ key: "_user_1", name: "DeskFox-Mac", openId: "ou_bot_actual" }],
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  test("p2p 私聊 + requireMention=true → 不受影响,正常响应", async () => {
    const pipeline = makePipeline({ requireMention: true })
    void pipeline.testHandle(
      makeEvent({
        chatType: "p2p",
        content: JSON.stringify({ text: "你好" }),
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  test("group + requireMention=true + botName 空(fetchBotName 失败)→ fail open 正常响应", async () => {
    // [feat hot fix] botName 缺失 → isBotMentioned 返 true → 不早退,正常响应
    // 设计:避免吞掉所有群消息,user 体验优先
    const pipeline = makePipeline({ requireMention: true, botName: "" })
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "@_user_1 你好" }),
        mentions: [{ key: "_user_1", name: "anyone", openId: "ou_anyone" }],
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  test("group + requireMention=true + 多 @(含 bot 名)→ 命中,正常响应", async () => {
    const pipeline = makePipeline({ requireMention: true, botName: "DeskFox-Mac" })
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "@_user_1 @_user_2 你们好" }),
        mentions: [
          { key: "_user_1", name: "alice", openId: "ou_alice" },
          { key: "_user_2", name: "DeskFox-Mac", openId: "ou_bot_actual" },
        ],
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fakes.ackedMessages).toEqual(["om_test_1"])
  })

  // [bug-repro: LLM 收到原始 @_user_1 占位符 — 应改传 stripMentions 后的 cleaned text]
  // user 2026-05-24 实测:群里 @bot 说"@_user_1 说句话",bot reply 含"我不是 @_user_1..."
  // 因为 pipeline runOpencode 传 raw text 进 LLM,占位符没 strip,LLM 误当另一个联系人
  test("group + bot @ → LLM 收到的 text 已 strip mention 占位符(bug-repro)", async () => {
    const pipeline = makePipeline({ requireMention: true, botName: "DeskFox-Mac" })
    let capturedText: string | undefined
    fakes.opencodeClient.session.promptAsync = async (args: any) => {
      capturedText = args.body?.parts?.[0]?.text
      return { data: {} } as any
    }
    void pipeline.testHandle(
      makeEvent({
        chatType: "group",
        content: JSON.stringify({ text: "@_user_1 说句话" }),
        mentions: [{ key: "_user_1", name: "DeskFox-Mac", openId: "ou_bot" }],
      }),
    )
    // 给 fire-and-forget promptAsync 一点时间被调到
    await new Promise((r) => setTimeout(r, 100))
    expect(capturedText).toBe("说句话")
    expect(capturedText).not.toContain("@_user_1")
  })

  test("p2p + LLM 收到的 text 也 strip mention 占位符(bug-repro 私聊场景)", async () => {
    // p2p 一般不带 mention,但万一带也要 strip
    const pipeline = makePipeline({ requireMention: true, botName: "灵狐🦊-Mac" })
    let capturedText: string | undefined
    fakes.opencodeClient.session.promptAsync = async (args: any) => {
      capturedText = args.body?.parts?.[0]?.text
      return { data: {} } as any
    }
    void pipeline.testHandle(
      makeEvent({
        chatType: "p2p",
        content: JSON.stringify({ text: "@_user_1  说句话" }),
        mentions: [{ key: "_user_1", name: "灵狐🦊-Mac", openId: "ou_bot" }],
      }),
    )
    await new Promise((r) => setTimeout(r, 100))
    expect(capturedText).toBe("说句话")
  })
})

// ============================================================
// [ATTACH:path] processAttachments 集成测 (feat: feishu-bridge-light Phase 2)
// ============================================================

import { writeFileSync } from "node:fs"

interface AttachFakeImageCall {
  image_type: string
}
interface AttachFakeFileCall {
  file_type: string
  file_name: string
}
interface AttachFakeMessageCall {
  receive_id: string
  msg_type: string
  content: string
}

/**
 * [feishu-attach-upload-robustness iter 4] 2026-05-24
 * uploadImage / uploadFile 改走 Bun-native fetch → 这里加 fetch mock,
 * 让原 imageCalls / fileCalls 断言面继续工作(image_type / file_type / file_name 都从 FormData 提)。
 */
function makeAttachFakes(opts: { imageError?: Error; fileError?: Error } = {}) {
  const imageCalls: AttachFakeImageCall[] = []
  const fileCalls: AttachFakeFileCall[] = []
  const messageCalls: AttachFakeMessageCall[] = []

  const larkClient = {
    domain: "https://open.feishu.cn",
    tokenManager: {
      getTenantAccessToken: async (_o: object) => "fake_tenant_token",
    },
    im: {
      v1: {
        message: {
          create: async (args: any) => {
            messageCalls.push({
              receive_id: args.data.receive_id,
              msg_type: args.data.msg_type,
              content: args.data.content,
            })
            return { data: { message_id: `om_${messageCalls.length}` } }
          },
        },
        messageReaction: { create: async () => ({ data: {} }) },
      },
    },
  } as any

  const originalFetch = globalThis.fetch
  const installFetchMock = () => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input)
      const isImage = url.includes("/open-apis/im/v1/images")
      const isFile = url.includes("/open-apis/im/v1/files")
      if (!isImage && !isFile) {
        throw new Error(`makeAttachFakes: unexpected fetch URL ${url}`)
      }
      const form = init?.body as FormData | undefined
      const fields: Record<string, string> = {}
      if (form && typeof form.entries === "function") {
        for (const [k, v] of form.entries()) {
          if (typeof v !== "object") fields[k] = String(v)
          else if (v === null) continue
          else if (!("size" in (v as object))) fields[k] = String(v)
        }
      }
      if (isImage) {
        if (opts.imageError) throw opts.imageError
        imageCalls.push({ image_type: fields.image_type ?? "" })
        return new Response(
          JSON.stringify({ code: 0, msg: "ok", data: { image_key: `img_${imageCalls.length}` } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      } else {
        if (opts.fileError) throw opts.fileError
        fileCalls.push({
          file_type: fields.file_type ?? "",
          file_name: fields.file_name ?? "",
        })
        return new Response(
          JSON.stringify({ code: 0, msg: "ok", data: { file_key: `file_${fileCalls.length}` } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
    }) as unknown as typeof fetch
  }
  const uninstallFetchMock = () => {
    globalThis.fetch = originalFetch
  }

  const opencodeClient = { session: { create: async () => ({}) } } as any
  return {
    imageCalls,
    fileCalls,
    messageCalls,
    larkClient,
    opencodeClient,
    installFetchMock,
    uninstallFetchMock,
  }
}

describe("processAttachments (feat: feishu-bridge-light Phase 2)", () => {
  let tmpDir: string
  let workspaceRoot: string
  let store: ChatSessionStore
  let dispatcher: PromptDispatcher
  let fakes: ReturnType<typeof makeAttachFakes>
  let pipeline: MessagePipeline

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "attach-pipeline-test-"))
    workspaceRoot = join(tmpDir, "feishu-workspace")
    // 用 mkdir 创建 workspace 根 + 写文件 fixture
    writeFileSync(join(tmpDir, "non-fixture.txt"), "outside")
    // 使用 fs.mkdirSync 显式建 workspace 子目录
    require("node:fs").mkdirSync(workspaceRoot, { recursive: true })
    store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    dispatcher = new PromptDispatcher()
    fakes = makeAttachFakes()
    fakes.installFetchMock()
    pipeline = new MessagePipeline({
      account: makeAccount(),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
      attachWorkspaceRoot: workspaceRoot,
    })
  })

  afterEach(() => {
    fakes.uninstallFetchMock()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeWsFile(name: string, size = 100): string {
    const p = join(workspaceRoot, name)
    writeFileSync(p, Buffer.alloc(size))
    return p
  }

  test("无 marker → 返回原文", async () => {
    const out = await pipeline.processAttachments("hello world", "oc_x")
    expect(out).toBe("hello world")
    expect(fakes.imageCalls).toHaveLength(0)
    expect(fakes.fileCalls).toHaveLength(0)
  })

  test("单 [ATTACH:img.png] workspace 内 → image.create + message.create(image)", async () => {
    const p = writeWsFile("a.png")
    const out = await pipeline.processAttachments(`图来了 [ATTACH:${p}] 完毕`, "oc_x")
    expect(fakes.imageCalls).toHaveLength(1)
    expect(fakes.messageCalls).toHaveLength(1)
    expect(fakes.messageCalls[0]!.msg_type).toBe("image")
    expect(JSON.parse(fakes.messageCalls[0]!.content).image_key).toBe("img_1")
    // marker 已 strip
    expect(out).not.toContain("[ATTACH:")
    expect(out).toContain("图来了")
    expect(out).toContain("完毕")
  })

  test("单 [ATTACH:report.pdf] workspace 内 → file.create(pdf) + message.create(file)", async () => {
    const p = writeWsFile("report.pdf")
    await pipeline.processAttachments(`报告 [ATTACH:${p}]`, "oc_x")
    expect(fakes.fileCalls).toHaveLength(1)
    expect(fakes.fileCalls[0]).toEqual({ file_type: "pdf", file_name: "report.pdf" })
    expect(fakes.messageCalls[0]!.msg_type).toBe("file")
  })

  test("docx → file_type stream 兜底", async () => {
    const p = writeWsFile("a.docx")
    await pipeline.processAttachments(`[ATTACH:${p}]`, "oc_x")
    expect(fakes.fileCalls[0]!.file_type).toBe("stream")
  })

  test("路径在 workspace 外 → reject,reply 含 warning,不调 SDK", async () => {
    const p = join(tmpDir, "non-fixture.txt") // 在 tmpDir 内但不在 workspaceRoot 子树
    const out = await pipeline.processAttachments(`看 [ATTACH:${p}]`, "oc_x")
    expect(fakes.imageCalls).toHaveLength(0)
    expect(fakes.fileCalls).toHaveLength(0)
    expect(out).toContain("⚠️ 拒绝发送")
    expect(out).toContain("workspace 外")
  })

  test("相对路径 → reject", async () => {
    const out = await pipeline.processAttachments("[ATTACH:./local.png]", "oc_x")
    expect(out).toContain("⚠️ 拒绝发送")
    expect(out).toContain("非绝对路径")
  })

  test("多 ATTACH 混合:1 image + 1 file + 1 reject → 各自处理", async () => {
    const img = writeWsFile("a.png")
    const pdf = writeWsFile("a.pdf")
    const out = await pipeline.processAttachments(
      `图 [ATTACH:${img}] 文档 [ATTACH:${pdf}] 越界 [ATTACH:/etc/passwd]`,
      "oc_x",
    )
    expect(fakes.imageCalls).toHaveLength(1)
    expect(fakes.fileCalls).toHaveLength(1)
    expect(fakes.messageCalls).toHaveLength(2) // 1 image msg + 1 file msg
    expect(out).toContain("⚠️ 拒绝发送")
    expect(out).toContain("/etc/passwd")
    expect(out).not.toContain("[ATTACH:")
  })

  test("上传抛错 → 不阻断,append warning", async () => {
    // [feat: feishu-attach-upload-robustness] 2026-05-24
    // 用 non-recoverable 错(401)避免 retry 3 次拖慢测试(1s+3s prod delay)
    fakes.uninstallFetchMock() // 拆掉 beforeEach 的默认 mock,换装 imageError 版
    fakes = makeAttachFakes({ imageError: new Error("401 Unauthorized") })
    fakes.installFetchMock()
    pipeline = new MessagePipeline({
      account: makeAccount(),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
      attachWorkspaceRoot: workspaceRoot,
    })
    const p = writeWsFile("a.png")
    const out = await pipeline.processAttachments(`[ATTACH:${p}]`, "oc_x")
    expect(fakes.imageCalls).toHaveLength(0) // image.create 抛了,不计 push
    expect(fakes.messageCalls).toHaveLength(0)
    expect(out).toContain("⚠️ 发送")
    expect(out).toContain("401 Unauthorized")
  })

  test("仅 ATTACH 无其它文字 → cleanText 空,只发附件", async () => {
    const p = writeWsFile("only.png")
    const out = await pipeline.processAttachments(`[ATTACH:${p}]`, "oc_x")
    expect(fakes.imageCalls).toHaveLength(1)
    expect(out).toBe("") // 全 strip 后无 warning 也无文字
  })

  test("size 超 10MB image → reject(预检,不调 SDK)", async () => {
    const p = writeWsFile("big.png", 11 * 1024 * 1024)
    const out = await pipeline.processAttachments(`[ATTACH:${p}]`, "oc_x")
    expect(fakes.imageCalls).toHaveLength(0)
    expect(out).toContain("超过")
  })
})


// ============================================================
// getSystemPrompt 动态拼接 (feat: feishu-bridge-light Phase 3)
// ============================================================

describe("getSystemPrompt (feat: feishu-group-slash-command)", () => {
  function buildPipeline(): MessagePipeline {
    const tmpDir = mkdtempSync(join(tmpdir(), "sysprompt-test-"))
    const store = new ChatSessionStore(join(tmpDir, "sessions.json"))
    const dispatcher = new PromptDispatcher()
    const fakes = makeAttachFakes()
    const pipeline = new MessagePipeline({
      account: makeAccount(),
      accountId: "acc1",
      opencodeClient: fakes.opencodeClient,
      dispatcher,
      chatSessionStore: store,
      larkClient: fakes.larkClient,
    })
    return pipeline
  }

  test("含 ATTACH 协议 + 建群引导段", () => {
    const p = buildPipeline()
    const prompt = (p as any).getSystemPrompt()
    expect(prompt).toContain("文件回传协议")
    expect(prompt).toContain("[ATTACH:")
    // 建群引导段(替代了原 CREATE_GROUP_MARKER_PROMPT 和 CREATE_GROUP_DISABLED_PROMPT)
    expect(prompt).toContain("建群引导")
    expect(prompt).toContain("/group <群名>")
    expect(prompt).toContain("/group 项目讨论")
  })

  test("不含已删除的 [CREATE_GROUP:name] marker 协议", () => {
    const p = buildPipeline()
    const prompt = (p as any).getSystemPrompt()
    expect(prompt).not.toContain("[CREATE_GROUP:")
    expect(prompt).not.toContain("自动建群协议")
    expect(prompt).not.toContain("建群能力未启用")
  })

  test("建群引导段明确禁止替代路径 + 防凭证泄露", () => {
    const p = buildPipeline()
    const prompt = (p as any).getSystemPrompt()
    expect(prompt).toContain("不要")
    expect(prompt).toContain("不要尝试自己建群")
    expect(prompt).toContain("不要读源码")
    expect(prompt).toContain("不要调飞书 SDK")
    expect(prompt).toContain("appSecret")
  })

  test("base prompt 总是含禁用反问工具的指引", () => {
    const p = buildPipeline()
    const prompt = (p as any).getSystemPrompt()
    expect(prompt).toContain("禁止")
    expect(prompt).toContain("反问")
  })
})
