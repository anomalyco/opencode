// FORK: 飞书桥接前端 invoke wrapper(C1.5)— 主进程 Tauri commands 类型化包装
// [feat: feishu-bridge] 2026-05-08
//
// 直接手写类型(不依赖 bindings.ts 自动生成,等 release build 才更新),
// 与 Rust 端 feishu_adapter.rs 中的 OauthStartResponse / OauthPollResponse 严格对齐。

import { invoke } from "@tauri-apps/api/core"

export type FeishuDomain = "feishu" | "lark"

export interface OauthStartResponse {
  session_id: string
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export type OauthPollStatus =
  | "success"
  | "pending"
  | "slow_down"
  | "denied"
  | "expired"
  | "error"

export interface OauthPollResponse {
  status: OauthPollStatus
  app_id?: string
  app_secret?: string
  open_id?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
  message?: string
  code?: string
  next_interval_ms?: number
}

/** adapter sidecar 是否已就绪(GUI 在 OAuth 操作前 check) */
export async function feishuAdapterStatus(): Promise<boolean> {
  return await invoke<boolean>("feishu_adapter_status")
}

/** 启动 OAuth(init + begin)→ 返 device_code / user_code / verification_uri 等 */
export async function feishuOauthStart(domain: FeishuDomain): Promise<OauthStartResponse> {
  return await invoke<OauthStartResponse>("feishu_oauth_start", {
    request: { domain },
  })
}

/** 一次 poll — 调用方按 interval 间隔重试 */
export async function feishuOauthPoll(sessionId: string): Promise<OauthPollResponse> {
  return await invoke<OauthPollResponse>("feishu_oauth_poll", {
    request: { session_id: sessionId },
  })
}
