// [fork-only] confirm-card 单测
// [feat: feishu-bridge-light] 2026-05-23

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  buildConfirmCard,
  buildSettledConfirmCard,
  ConfirmCardController,
  parseConfirmAction,
} from "../confirm-card"

const baseSpec = {
  title: "🆕 创建群【需求讨论】?",
  body: "AI 想自动创建群 **需求讨论**,点确认才会建。",
}

// ============================================================
// buildConfirmCard
// ============================================================

describe("buildConfirmCard", () => {
  test("生成卡片结构 — header + div + action 2 button", () => {
    const card = buildConfirmCard(baseSpec, "req_TEST_1")
    expect(card.header?.title.content).toBe("🆕 创建群【需求讨论】?")
    expect(card.header?.template).toBe("blue")
    expect(card.elements).toHaveLength(2)
    const actionEl = card.elements[1] as {
      tag: string
      actions: Array<{ value: { kind: string; requestID: string; reply: string } }>
    }
    expect(actionEl.tag).toBe("action")
    expect(actionEl.actions).toHaveLength(2)
    expect(actionEl.actions.map((a) => a.value.reply)).toEqual(["yes", "no"])
    for (const btn of actionEl.actions) {
      expect(btn.value.kind).toBe("confirm_reply")
      expect(btn.value.requestID).toBe("req_TEST_1")
    }
  })

  test("template 可覆盖", () => {
    const card = buildConfirmCard({ ...baseSpec, template: "red" }, "req_x")
    expect(card.header?.template).toBe("red")
  })
})

describe("buildSettledConfirmCard", () => {
  test("yes → header 加'已确认'后缀 + green template", () => {
    const card = buildSettledConfirmCard(baseSpec, "yes")
    expect(card.header?.title.content).toContain("已确认")
    expect(card.header?.template).toBe("green")
    expect(card.elements).toHaveLength(1) // div only,无 action
  })

  test("no → grey + 已拒绝", () => {
    const card = buildSettledConfirmCard(baseSpec, "no")
    expect(card.header?.title.content).toContain("已拒绝")
    expect(card.header?.template).toBe("grey")
  })

  test("timeout → grey + 超时未响应", () => {
    const card = buildSettledConfirmCard(baseSpec, "timeout")
    expect(card.header?.title.content).toContain("超时未响应")
    expect(card.header?.template).toBe("grey")
  })
})

// ============================================================
// parseConfirmAction
// ============================================================

describe("parseConfirmAction", () => {
  test("yes 合法 → 解析", () => {
    const r = parseConfirmAction({
      action: { value: { kind: "confirm_reply", requestID: "r1", reply: "yes" } },
      open_message_id: "om_x",
      open_id: "ou_y",
    })
    expect(r).toEqual({ requestID: "r1", reply: "yes", cardMessageId: "om_x", openId: "ou_y" })
  })

  test("no 合法 → 解析", () => {
    const r = parseConfirmAction({
      action: { value: { kind: "confirm_reply", requestID: "r1", reply: "no" } },
    })
    expect(r?.reply).toBe("no")
  })

  test("kind 不匹配(permission_reply)→ null", () => {
    expect(
      parseConfirmAction({
        action: { value: { kind: "permission_reply", requestID: "r1", reply: "once" } },
      }),
    ).toBeNull()
  })

  test("非法 reply → null", () => {
    expect(
      parseConfirmAction({
        action: { value: { kind: "confirm_reply", requestID: "r1", reply: "maybe" } },
      }),
    ).toBeNull()
  })

  test("空 / 异常 input → null", () => {
    expect(parseConfirmAction(null)).toBeNull()
    expect(parseConfirmAction({})).toBeNull()
    expect(parseConfirmAction({ action: null })).toBeNull()
    expect(parseConfirmAction({ action: { value: null } })).toBeNull()
  })
})

// ============================================================
// ConfirmCardController
// ============================================================

interface SentCard {
  chatId: string
  content: string
}

function makeFakes() {
  const sentCards: SentCard[] = []
  const deletedCards: string[] = []
  let counter = 0
  const larkClient = {
    im: {
      v1: {
        message: {
          create: async (args: any) => {
            counter++
            sentCards.push({ chatId: args.data.receive_id, content: args.data.content })
            return { data: { message_id: `om_${counter}` } }
          },
          delete: async (args: any) => {
            deletedCards.push(args.path.message_id)
            return { data: {} }
          },
        },
      },
    },
  } as any
  return { larkClient, sentCards, deletedCards }
}

describe("ConfirmCardController", () => {
  let controller: ConfirmCardController
  let fakes: ReturnType<typeof makeFakes>

  beforeEach(() => {
    fakes = makeFakes()
    controller = new ConfirmCardController({
      larkClient: fakes.larkClient,
      timeoutMs: 100,
    })
  })

  afterEach(() => {
    controller.abortAll()
  })

  test("start → 发卡片 + 记 pending", async () => {
    await controller.start("req_1", "oc_chat_x", baseSpec, async () => {})
    expect(fakes.sentCards).toHaveLength(1)
    expect(fakes.sentCards[0]!.chatId).toBe("oc_chat_x")
    expect(controller.size).toBe(1)
  })

  test("handleReply yes → callback(true) 被调,删原卡片 + 发 settled", async () => {
    let cbArg: boolean | undefined
    await controller.start("req_2", "oc_chat", baseSpec, async (c) => {
      cbArg = c
    })
    await controller.handleReply({ requestID: "req_2", reply: "yes" })
    expect(cbArg).toBe(true)
    expect(controller.size).toBe(0)
    expect(fakes.deletedCards).toHaveLength(1)
    expect(fakes.sentCards).toHaveLength(2) // 原 + settled
    expect(fakes.sentCards[1]!.content).toContain("已确认")
  })

  test("handleReply no → callback(false) 被调", async () => {
    let cbArg: boolean | undefined
    await controller.start("req_3", "oc_chat", baseSpec, async (c) => {
      cbArg = c
    })
    await controller.handleReply({ requestID: "req_3", reply: "no" })
    expect(cbArg).toBe(false)
  })

  test("handleReply 未知 requestID → noop", async () => {
    let called = false
    await controller.start("req_4", "oc_chat", baseSpec, async () => {
      called = true
    })
    await controller.handleReply({ requestID: "req_unknown", reply: "yes" })
    expect(called).toBe(false)
    expect(controller.size).toBe(1) // 原 req_4 还在
  })

  test("超时 → callback(false) + settled timeout 卡片", async () => {
    let cbArg: boolean | undefined
    await controller.start("req_5", "oc_chat", baseSpec, async (c) => {
      cbArg = c
    })
    expect(controller.size).toBe(1)
    await new Promise((r) => setTimeout(r, 150))
    expect(cbArg).toBe(false)
    expect(controller.size).toBe(0)
    expect(fakes.sentCards[1]!.content).toContain("超时未响应")
  })

  test("user 早于 timeout 点击 → timer 取消", async () => {
    let cbCount = 0
    await controller.start("req_6", "oc_chat", baseSpec, async () => {
      cbCount++
    })
    await controller.handleReply({ requestID: "req_6", reply: "yes" })
    expect(cbCount).toBe(1)
    await new Promise((r) => setTimeout(r, 150))
    expect(cbCount).toBe(1) // timeout 未额外触发
  })

  test("重复 start 同 requestID → 第二次 skip", async () => {
    await controller.start("req_7", "oc_chat", baseSpec, async () => {})
    await controller.start("req_7", "oc_chat", baseSpec, async () => {})
    expect(fakes.sentCards).toHaveLength(1)
  })

  test("发卡片失败 → 立即 callback(false) 解锁", async () => {
    fakes.larkClient.im.v1.message.create = async () => {
      throw new Error("lark 502")
    }
    let cbArg: boolean | undefined
    await controller.start("req_8", "oc_chat", baseSpec, async (c) => {
      cbArg = c
    })
    expect(cbArg).toBe(false)
    expect(controller.size).toBe(0)
  })

  test("abortAll 清空 pending", async () => {
    await controller.start("req_9", "oc_chat", baseSpec, async () => {})
    await controller.start("req_10", "oc_chat", baseSpec, async () => {})
    expect(controller.size).toBe(2)
    controller.abortAll()
    expect(controller.size).toBe(0)
  })
})
