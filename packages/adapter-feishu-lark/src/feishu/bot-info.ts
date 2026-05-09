// [fork-only] 飞书 / Lark bot 信息拉取(用于 settings 显示 bot 名)
// [feat: feishu-bridge] 2026-05-09
//
// 流程:
//   1. POST /open-apis/auth/v3/tenant_access_token/internal — 拿 tenant_access_token
//   2. GET  /open-apis/bot/v3/info — 拿 bot.app_name
//
// 任何步骤失败抛 Error,调用方按 best-effort 处理(saveAccount / 启动后台刷新都允许失败)。

import type { FeishuDomain } from "../core/config-schema"

export async function fetchBotName(
  domain: FeishuDomain,
  appId: string,
  appSecret: string,
): Promise<string> {
  const apiBase = domain === "feishu" ? "https://open.feishu.cn" : "https://open.larksuite.com"
  // 1. tenant_access_token
  const tokenRes = await fetch(`${apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const tokenJson = (await tokenRes.json()) as {
    code?: number
    msg?: string
    tenant_access_token?: string
  }
  if (!tokenRes.ok || tokenJson.code !== 0 || !tokenJson.tenant_access_token) {
    throw new Error(`tenant_access_token: ${tokenJson.msg ?? "unknown"}`)
  }
  // 2. bot info
  const botRes = await fetch(`${apiBase}/open-apis/bot/v3/info`, {
    method: "GET",
    headers: { Authorization: `Bearer ${tokenJson.tenant_access_token}` },
  })
  const botJson = (await botRes.json()) as {
    code?: number
    msg?: string
    bot?: { app_name?: string }
  }
  if (!botRes.ok || botJson.code !== 0 || !botJson.bot) {
    throw new Error(`bot info: ${botJson.msg ?? "unknown"}`)
  }
  return botJson.bot.app_name ?? ""
}
