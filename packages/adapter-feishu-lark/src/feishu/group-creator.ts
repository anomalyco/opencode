// [fork-only] group-creator — 飞书建群 + 邀请链接 IO 包装
// [feat: feishu-bridge-light] 2026-05-23
//
// 跟飞书 SDK 直连的建群 IO,跟 confirm-card(UI)+ message-pipeline(流转)分层:
//   - createGroup:调 im.v1.chat.create 建群,可同时拉 user 进群(user_id_list)
//   - getShareLink:调 im.v1.chat.link 拿邀请链接(一周有效),团队群等情况下降级返 null
//
// 飞书 SDK 注意点(2026-05-23 验证):
//   - chat.create 真实签名:{ data: { name, ... }, params: { user_id_type } }
//   - chat.create 返回值含 chat_id,但 **不含** 邀请链接 — 必须另调 chat.link 拿
//   - chat.link 官方限制:单聊 / 密聊 / 团队群 不支持分享链接;失败兜底返 null 让 caller 降级显示 chat_id
//   - chat.create 传 user_id_list 时必须 params.user_id_type 跟 list 里 id 格式一致

import type { Client } from "@larksuiteoapi/node-sdk"

export interface CreateGroupResult {
  chatId: string
  /** 飞书返回的群名(可能跟传入轻微差异,如 trim)。caller 用此做后续显示一致性 */
  name: string
}

/**
 * 创建公开群,可同时把指定 user open_id 拉进群。
 *
 * @param userOpenIds 要拉进群的 user open_id 列表(空数组 = 只 bot 在群里)
 */
export async function createGroup(
  client: Client,
  name: string,
  userOpenIds: ReadonlyArray<string>,
): Promise<CreateGroupResult> {
  const res = await client.im.v1.chat.create({
    data: {
      name,
      // [feat: feishu-group-mention-policy] 2026-05-24 默认 private(私密群)
      // user 通过 DeskFox 流程主动建群,等同私聊衍生 transactional 操作 — 默认应只
      // 让 user 邀请的人能进(`chat.link` 一周邀请链接 + 后续可手动 add user)。
      // private 群飞书企业内部成员搜不到,符合 user 心理预期(我建的群我决定谁加入)。
      chat_type: "private",
      user_id_list: userOpenIds.length > 0 ? [...userOpenIds] : undefined,
    },
    params: { user_id_type: "open_id" },
  })
  const data = (res as { data?: { chat_id?: string; name?: string } }).data
  const chatId = data?.chat_id
  if (!chatId) throw new Error("chat.create 未返回 chat_id")
  return { chatId, name: data?.name ?? name }
}

/**
 * 拿群分享链接(一周有效)。
 *
 * 失败原因(飞书官方文档):
 *   - 单聊 / 密聊 / 团队群 不支持分享链接(API 返非 0 code)
 *   - bot 不在群里 / 权限不足
 *   - 群已停用
 *
 * 失败时 console.warn 但**返 null** — 让 caller 用 chat_id 降级显示给 user(不阻断流程)。
 */
export async function getShareLink(client: Client, chatId: string): Promise<string | null> {
  try {
    const res = await client.im.v1.chat.link({
      data: { validity_period: "week" },
      path: { chat_id: chatId },
    })
    const link = (res as { data?: { share_link?: string } }).data?.share_link
    if (!link) {
      console.warn(`[group-creator] chat.link for ${chatId} 返回空 share_link`)
      return null
    }
    return link
  } catch (err) {
    console.warn(
      `[group-creator] chat.link for ${chatId} failed:`,
      (err as Error).message,
    )
    return null
  }
}
