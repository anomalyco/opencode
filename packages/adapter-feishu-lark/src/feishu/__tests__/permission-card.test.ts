// [fork-only] PermissionCard 单测 — buildPermissionCard 渲染 + parseCardAction 解析 + Controller 行为
// [feat: feishu-bridge-permission-card] 2026-05-10

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  buildPermissionCard,
  parseCardAction,
  PermissionCardController,
  type PermissionRequest,
} from "../permission-card"

const baseRequest: PermissionRequest = {
  id: "perm_TEST_1",
  sessionID: "ses_TEST",
  permission: "external_directory",
  patterns: ["C:\\Users\\yuexi\\.opencode\\*"],
  metadata: {
    filepath: "C:\\Users\\yuexi\\.opencode\\config.json",
    parentDir: "C:\\Users\\yuexi\\.opencode",
  },
  always: ["C:\\Users\\yuexi\\.opencode\\*"],
}

// ============================================================
// buildPermissionCard
// ============================================================

describe("buildPermissionCard", () => {
  test("生成有效 InteractiveCard 结构 — header + elements + 3 按钮", () => {
    const card = buildPermissionCard(baseRequest)
    expect(card.header).toBeDefined()
    expect(card.header?.title.content).toContain("📁") // external_directory emoji
    expect(card.header?.title.content).toContain("访问项目目录之外的文件")
    expect(card.elements.length).toBeGreaterThanOrEqual(3) // patterns + meta + note + action

    const actionEl = card.elements.find(
      (e) => (e as { tag?: string }).tag === "action",
    ) as { actions: Array<{ value: { kind: string; reply: string } }> }
    expect(actionEl).toBeDefined()
    expect(actionEl.actions.length).toBe(3)
    expect(actionEl.actions.map((a) => a.value.reply)).toEqual(["once", "always", "reject"])
    for (const btn of actionEl.actions) {
      expect(btn.value.kind).toBe("permission_reply")
    }
  })

  test("未知 permission key fallback 到 🔐 + 原 key 显示", () => {
    const req = { ...baseRequest, permission: "unknown_xyz" }
    const card = buildPermissionCard(req)
    expect(card.header?.title.content).toContain("🔐")
    expect(card.header?.title.content).toContain("unknown_xyz")
  })

  test("超过 5 个 patterns 截断显示 + 余项提示", () => {
    const req = {
      ...baseRequest,
      patterns: ["a", "b", "c", "d", "e", "f", "g"],
    }
    const card = buildPermissionCard(req)
    const patternsEl = card.elements[0] as { text: { content: string } }
    expect(patternsEl.text.content).toContain("…还有 2 项")
    expect(patternsEl.text.content).toContain("`a`")
    expect(patternsEl.text.content).toContain("`e`")
    expect(patternsEl.text.content).not.toContain("`f`")
  })

  test("空 metadata 不渲染 meta block", () => {
    const req = { ...baseRequest, metadata: {} }
    const card = buildPermissionCard(req)
    // 没 meta block 时,elements = [patterns, note, action] 三块
    const tags = card.elements.map((e) => (e as { tag?: string }).tag)
    // patterns_div + note + action — 不该出现额外 div(meta block)
    expect(tags.filter((t) => t === "div")).toHaveLength(1)
  })

  test("metadata 含非原始类型(数组 / 对象)被跳过", () => {
    const req = {
      ...baseRequest,
      metadata: {
        filepath: "/path/x",
        complex: { nested: "obj" },
        list: [1, 2, 3],
      },
    }
    const card = buildPermissionCard(req)
    const metaEl = card.elements[1] as { text: { content: string } }
    expect(metaEl.text.content).toContain("filepath")
    expect(metaEl.text.content).not.toContain("complex")
    expect(metaEl.text.content).not.toContain("list")
  })

  test("超长 pattern 自动截断到 150 字符", () => {
    const longPath = "A".repeat(200)
    const req = { ...baseRequest, patterns: [longPath] }
    const card = buildPermissionCard(req)
    const patternsEl = card.elements[0] as { text: { content: string } }
    expect(patternsEl.text.content).toContain("…")
    expect(patternsEl.text.content.length).toBeLessThan(longPath.length + 10)
  })
})

// ============================================================
// parseCardAction
// ============================================================

describe("parseCardAction", () => {
  test("合法 permission_reply 卡片 action → 解析", () => {
    const event = {
      open_id: "ou_xxx",
      open_message_id: "om_xxx",
      action: {
        value: { kind: "permission_reply", requestID: "perm_1", reply: "once" },
        tag: "button",
      },
    }
    const r = parseCardAction(event)
    expect(r).toEqual({
      requestID: "perm_1",
      reply: "once",
      cardMessageId: "om_xxx",
      openId: "ou_xxx",
    })
  })

  test("非 permission_reply 卡片 action → null(其他卡片应被忽略)", () => {
    const event = {
      action: { value: { kind: "other_card", foo: "bar" }, tag: "button" },
    }
    expect(parseCardAction(event)).toBeNull()
  })

  test("没有 action.value → null", () => {
    expect(parseCardAction({ action: { tag: "button" } })).toBeNull()
  })

  test("非法 reply 类型 → null", () => {
    const event = {
      action: { value: { kind: "permission_reply", requestID: "p", reply: "invalid" } },
    }
    expect(parseCardAction(event)).toBeNull()
  })

  test("requestID 不是 string → null", () => {
    const event = {
      action: { value: { kind: "permission_reply", requestID: 123, reply: "once" } },
    }
    expect(parseCardAction(event)).toBeNull()
  })

  test("event 是 null / undefined / 非 object → null", () => {
    expect(parseCardAction(null)).toBeNull()
    expect(parseCardAction(undefined)).toBeNull()
    expect(parseCardAction("string")).toBeNull()
  })

  test("3 种合法 reply 都识别", () => {
    for (const reply of ["once", "always", "reject"] as const) {
      const r = parseCardAction({
        action: { value: { kind: "permission_reply", requestID: "p", reply } },
      })
      expect(r?.reply).toBe(reply)
    }
  })
})

// ============================================================
// PermissionCardController
// ============================================================

interface FakeReplyCall {
  path: { id: string; permissionID: string }
  query: { directory: string }
  body: { response: string }
}

function makeFakes() {
  const replyCalls: FakeReplyCall[] = []
  const sentCards: Array<{ chatId: string; content: string }> = []

  const opencodeClient = {
    postSessionIdPermissionsPermissionId: async (args: any) => {
      replyCalls.push(args)
      return { data: true }
    },
  } as any

  const deletedCards: Array<{ messageId: string }> = []
  let createCounter = 0

  const larkClient = {
    im: {
      v1: {
        message: {
          create: async (args: any) => {
            createCounter++
            sentCards.push({
              chatId: args.data.receive_id,
              content: args.data.content,
            })
            return { data: { message_id: `om_fake_${createCounter}` } }
          },
          delete: async (args: any) => {
            deletedCards.push({ messageId: args.path.message_id })
            return { data: {} }
          },
        },
      },
    },
  } as any

  return { opencodeClient, larkClient, replyCalls, sentCards, deletedCards }
}

describe("PermissionCardController", () => {
  let controller: PermissionCardController
  let fakes: ReturnType<typeof makeFakes>

  beforeEach(() => {
    fakes = makeFakes()
    controller = new PermissionCardController({
      opencodeClient: fakes.opencodeClient,
      larkClient: fakes.larkClient,
      workspaceDir: "/test/workspace",
      timeoutMs: 100, // 短超时给 timeout 测试用
    })
  })

  afterEach(() => {
    controller.abortAll()
  })

  test("start → 发卡片到 chatId", async () => {
    await controller.start(baseRequest, "oc_TEST")
    expect(fakes.sentCards.length).toBe(1)
    expect(fakes.sentCards[0]?.chatId).toBe("oc_TEST")
    const cardJson = JSON.parse(fakes.sentCards[0]!.content)
    expect(cardJson.header.title.content).toContain("访问项目目录之外的文件")
    expect(controller.size).toBe(1)
  })

  test("handleReply once → 调 opencode postSessionIdPermissionsPermissionId", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "once" })
    expect(fakes.replyCalls.length).toBe(1)
    expect(fakes.replyCalls[0]).toEqual({
      path: { id: baseRequest.sessionID, permissionID: baseRequest.id },
      query: { directory: "/test/workspace" },
      body: { response: "once" },
    })
    expect(controller.size).toBe(0) // cleaned up after reply
  })

  test("handleReply always → 同款 reply", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "always" })
    expect(fakes.replyCalls[0]?.body.response).toBe("always")
  })

  test("handleReply reject → 同款 reply", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "reject" })
    expect(fakes.replyCalls[0]?.body.response).toBe("reject")
  })

  test("handleReply 未知 requestID(已 expired / 重复点击)→ noop", async () => {
    await controller.handleReply({ requestID: "perm_unknown", reply: "once" })
    expect(fakes.replyCalls.length).toBe(0)
  })

  test("timeout 自动 reject", async () => {
    await controller.start(baseRequest, "oc_TEST")
    expect(controller.size).toBe(1)
    await new Promise((r) => setTimeout(r, 150)) // > timeoutMs
    expect(controller.size).toBe(0)
    expect(fakes.replyCalls.length).toBe(1)
    expect(fakes.replyCalls[0]?.body.response).toBe("reject")
  })

  test("user 点击早于 timeout → 取消 timer,后续 timer 不再 fire", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "once" })
    expect(fakes.replyCalls.length).toBe(1)
    // 等超过 timeoutMs
    await new Promise((r) => setTimeout(r, 150))
    // timer 应被 cleanup,replyCalls 仍是 1 不是 2
    expect(fakes.replyCalls.length).toBe(1)
  })

  test("重复 start 同 requestID → 第二次警告 + 跳过", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.start(baseRequest, "oc_TEST")
    expect(fakes.sentCards.length).toBe(1) // 只发一次
    expect(controller.size).toBe(1)
  })

  test("start 失败(lark API 报错)→ 自动 reject 解锁,不卡 agent", async () => {
    fakes.larkClient.im.v1.message.create = async () => {
      throw new Error("lark api 502")
    }
    await controller.start(baseRequest, "oc_TEST")
    expect(fakes.replyCalls.length).toBe(1)
    expect(fakes.replyCalls[0]?.body.response).toBe("reject")
    expect(controller.size).toBe(0)
  })

  test("abortAll 清空所有 pending 不抛错", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.start({ ...baseRequest, id: "perm_2" }, "oc_TEST_2")
    expect(controller.size).toBe(2)
    controller.abortAll()
    expect(controller.size).toBe(0)
  })

  test("user 点 once → 撤回原卡片 + 发已确认 settled 卡片(header 变 green + 移除 action 段)", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "once" })
    // 1. 撤回了原卡片
    expect(fakes.deletedCards.length).toBe(1)
    expect(fakes.deletedCards[0]?.messageId).toBe("om_fake_1")
    // 2. 发了第二张 settled 卡片
    expect(fakes.sentCards.length).toBe(2)
    const settled = JSON.parse(fakes.sentCards[1]!.content)
    expect(settled.header.template).toBe("green")
    expect(settled.header.title.content).toContain("已允许一次")
    expect(
      (settled.elements as Array<{ tag: string }>).find((e) => e.tag === "action"),
    ).toBeUndefined()
  })

  test("user 点 reject → settled card header 变 red", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "reject" })
    const settled = JSON.parse(fakes.sentCards[1]!.content)
    expect(settled.header.template).toBe("red")
    expect(settled.header.title.content).toContain("已拒绝")
  })

  test("超时 → settled card header 变 grey + 显示已超时", async () => {
    await controller.start(baseRequest, "oc_TEST")
    await new Promise((r) => setTimeout(r, 150)) // > timeoutMs
    expect(fakes.deletedCards.length).toBe(1)
    expect(fakes.sentCards.length).toBe(2)
    const settled = JSON.parse(fakes.sentCards[1]!.content)
    expect(settled.header.template).toBe("grey")
    expect(settled.header.title.content).toContain("已超时")
  })

  test("delete API 失败 → silent warn,继续发新卡片", async () => {
    fakes.larkClient.im.v1.message.delete = async () => {
      throw new Error("delete api 502")
    }
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "once" })
    // delete 失败,但 settled 卡仍发出
    expect(fakes.sentCards.length).toBe(2)
    // reply 主路径不受影响
    expect(fakes.replyCalls.length).toBe(1)
    expect(fakes.replyCalls[0]?.body.response).toBe("once")
  })

  test("send settled card 失败 → silent warn,不阻塞 reply 主路径", async () => {
    let callCount = 0
    fakes.larkClient.im.v1.message.create = async (args: any) => {
      callCount++
      if (callCount === 1) {
        // 第一张原卡片正常发
        return { data: { message_id: "om_fake_orig" } }
      }
      throw new Error("create api 502")
    }
    await controller.start(baseRequest, "oc_TEST")
    await controller.handleReply({ requestID: baseRequest.id, reply: "once" })
    // 第 2 张 create 失败,但主 reply 路径不受影响
    expect(fakes.replyCalls.length).toBe(1)
    expect(fakes.replyCalls[0]?.body.response).toBe("once")
  })
})
