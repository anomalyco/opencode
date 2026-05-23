// [fork-only] group-creator 单测
// [feat: feishu-bridge-light] 2026-05-23

import { describe, expect, test } from "bun:test"
import { createGroup, getShareLink } from "../group-creator"

interface CreateChatCall {
  data: any
  params: any
}
interface ChatLinkCall {
  chat_id: string
  validity_period: string
}

function makeFakes(opts: {
  createResponse?: any
  createError?: Error
  linkResponse?: any
  linkError?: Error
} = {}) {
  const createCalls: CreateChatCall[] = []
  const linkCalls: ChatLinkCall[] = []
  const client = {
    im: {
      v1: {
        chat: {
          create: async (args: any) => {
            if (opts.createError) throw opts.createError
            createCalls.push({ data: args.data, params: args.params })
            return opts.createResponse ?? { data: { chat_id: "oc_NEW", name: args.data.name } }
          },
          link: async (args: any) => {
            if (opts.linkError) throw opts.linkError
            linkCalls.push({
              chat_id: args.path.chat_id,
              validity_period: args.data.validity_period,
            })
            return opts.linkResponse ?? {
              data: { share_link: "https://applink.feishu.cn/x/y/z" },
            }
          },
        },
      },
    },
  } as any
  return { client, createCalls, linkCalls }
}

describe("createGroup", () => {
  test("基本建群 → 调 chat.create + 返回 chatId/name", async () => {
    const { client, createCalls } = makeFakes()
    const r = await createGroup(client, "需求讨论", ["ou_user_1"])
    expect(r.chatId).toBe("oc_NEW")
    expect(r.name).toBe("需求讨论")
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]!.data.name).toBe("需求讨论")
    expect(createCalls[0]!.data.chat_type).toBe("public")
    expect(createCalls[0]!.data.user_id_list).toEqual(["ou_user_1"])
    expect(createCalls[0]!.params.user_id_type).toBe("open_id")
  })

  test("user_id_list 空数组 → 传 undefined(只 bot 在群)", async () => {
    const { client, createCalls } = makeFakes()
    await createGroup(client, "孤群", [])
    expect(createCalls[0]!.data.user_id_list).toBeUndefined()
  })

  test("多 user 一起拉", async () => {
    const { client, createCalls } = makeFakes()
    await createGroup(client, "大群", ["ou_a", "ou_b", "ou_c"])
    expect(createCalls[0]!.data.user_id_list).toEqual(["ou_a", "ou_b", "ou_c"])
  })

  test("SDK 返无 chat_id → 抛", async () => {
    const { client } = makeFakes({ createResponse: { data: {} } })
    await expect(createGroup(client, "x", [])).rejects.toThrow(/未返回 chat_id/)
  })

  test("SDK 抛 → 透传", async () => {
    const { client } = makeFakes({ createError: new Error("lark 502") })
    await expect(createGroup(client, "x", [])).rejects.toThrow(/lark 502/)
  })

  test("返回的 data.name 跟传入不同(SDK trim 或修)→ caller 用 SDK 返回值", async () => {
    const { client } = makeFakes({
      createResponse: { data: { chat_id: "oc_X", name: "需求讨论-修正后" } },
    })
    const r = await createGroup(client, "需求讨论", [])
    expect(r.name).toBe("需求讨论-修正后")
  })
})

describe("getShareLink", () => {
  test("正常 → 返 share_link", async () => {
    const { client, linkCalls } = makeFakes()
    const link = await getShareLink(client, "oc_X")
    expect(link).toBe("https://applink.feishu.cn/x/y/z")
    expect(linkCalls).toHaveLength(1)
    expect(linkCalls[0]).toEqual({ chat_id: "oc_X", validity_period: "week" })
  })

  test("SDK 抛(团队群 / 权限不足等)→ 返 null,不抛", async () => {
    const { client } = makeFakes({ linkError: new Error("permission denied") })
    const link = await getShareLink(client, "oc_X")
    expect(link).toBeNull()
  })

  test("SDK 返空 share_link → 返 null", async () => {
    const { client } = makeFakes({ linkResponse: { data: {} } })
    const link = await getShareLink(client, "oc_X")
    expect(link).toBeNull()
  })

  test("SDK 返空 data → 返 null", async () => {
    const { client } = makeFakes({ linkResponse: {} })
    expect(await getShareLink(client, "oc_X")).toBeNull()
  })
})
