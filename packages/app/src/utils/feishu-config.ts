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

// ============================================================
// 账户 CRUD(C1.6)
// ============================================================

export interface ModelRef {
  provider_id: string
  model_id: string
}

export interface AccountSummary {
  account_id: string
  app_id: string
  open_id: string
  domain: FeishuDomain
  agent: string
  enabled?: boolean
  model?: ModelRef | null
  bot_name?: string | null
  /** [feat: feishu-create-group-toggle-gui] 2026-05-24 当前 enableAutoGroupCreate flag */
  enable_auto_group_create?: boolean | null
}

/** opencode `/config/providers` 响应形状(Rust JSON value 直传) */
export interface ProvidersResponse {
  providers: Array<{
    id: string
    name: string
    models: Record<string, { id: string; name?: string }>
  }>
  default: Record<string, string>
}

export interface SaveAccountInput {
  domain: FeishuDomain
  app_id: string
  app_secret: string
  open_id: string
  account_id?: string
}

/** OAuth 成功后调,把凭证落到 ~/.opencode/feishu-config.json(SecretRef file mode 0600)*/
export async function feishuSaveAccount(input: SaveAccountInput): Promise<AccountSummary> {
  return await invoke<AccountSummary>("feishu_save_account", {
    request: input,
  })
}

/** 已绑定账号列表 */
export async function feishuListAccounts(): Promise<AccountSummary[]> {
  return await invoke<AccountSummary[]>("feishu_list_accounts")
}

/** 删除账号(同时删 SecretRef 文件)*/
export async function feishuDeleteAccount(accountId: string): Promise<boolean> {
  return await invoke<boolean>("feishu_delete_account", {
    request: { account_id: accountId },
  })
}

/** 更新指定账号的 model(model=null 清除,走全局 default)
 *
 * @deprecated 用 `feishuUpdateAccountSettings` 取代 — 同 endpoint 也能改 model。
 * 旧函数保留是为了向后兼容已有 callsite,新代码请用 settings 形式。
 */
export async function feishuUpdateAccountModel(
  accountId: string,
  model: ModelRef | null,
): Promise<boolean> {
  return await invoke<boolean>("feishu_update_account_model", {
    request: { account_id: accountId, model },
  })
}

/** Partial 更新账号 settings — 当前支持 model + enableAutoGroupCreate。
 *
 * 字段语义(对齐 Rust Option<Option<T>> 编码):
 *   - model: undefined = 不动;null = 清除走 default;ModelRef = 设置
 *   - enableAutoGroupCreate: undefined = 不动;true / false = 改
 *
 * [feat: feishu-create-group-toggle-gui] 2026-05-24
 */
export interface UpdateAccountSettingsPatch {
  /** undefined 不动 / null 清除 / ModelRef 设置 */
  model?: ModelRef | null
  /** undefined 不动 / true|false 改 */
  enableAutoGroupCreate?: boolean
}

export async function feishuUpdateAccountSettings(
  accountId: string,
  patch: UpdateAccountSettingsPatch,
): Promise<boolean> {
  // Rust 端 Option<Option<ModelRef>>:
  //   undefined → 不传字段 → Rust 视为 None(不动)
  //   null → 传 null → Rust 视为 Some(None)(清)
  //   object → 传 object → Rust 视为 Some(Some(m))(设)
  const request: Record<string, unknown> = { account_id: accountId }
  if (patch.model !== undefined) {
    request.model = patch.model
  }
  if (patch.enableAutoGroupCreate !== undefined) {
    request.enable_auto_group_create = patch.enableAutoGroupCreate
  }
  return await invoke<boolean>("feishu_update_account_settings", { request })
}

/** 拉 opencode 已配的 providers + models 列表(选 model 用) */
export async function feishuListProviders(): Promise<ProvidersResponse> {
  // Rust 端返 JSON 字符串(specta 不支持 generic JSON value),前端 parse
  const raw = await invoke<string>("feishu_list_providers")
  return JSON.parse(raw) as ProvidersResponse
}
