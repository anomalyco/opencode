// [fork-only] 飞书 OAuth Device Flow(RFC 8628 风格,飞书 PersonalAgent archetype)
// [feat: feishu-bridge] 2026-05-08
//
// 端点(实测调研产物 2026-05-07):
//   POST {accounts.feishu.cn 或 accounts.larksuite.com}/oauth/v1/app/registration
//   form-urlencoded,三 action:init / begin / poll
//
// 流程:
//   1. init    → 拿 nonce(JWT,60 秒过期)
//   2. begin   → 提交 archetype=PersonalAgent + auth_method=client_secret + request_user_info=open_id
//                → 返 device_code / user_code / verification_uri / expires_in / interval
//   3. user 用飞书 App 扫 verification_uri_complete → 同意授权 → 飞书企业内创建应用
//   4. poll    → 提交 device_code + nonce → 拿 { appId, appSecret, openId, accessToken, ... }
//                  pending → { error: "authorization_pending" }
//                  expired → { error: "expired_token" }
//                  denied  → { error: "access_denied" }
//
// 注:poll 响应字段在调研 README 里没有完整样本,本实现按 RFC 8628 标准 + 飞书风格
// 双向兼容(snake_case / camelCase 字段名都尝试解析)。Phase 2 真接入时 user 扫一次
// 真二维码,再按实测响应锁字段名。

// ============================================================
// 类型
// ============================================================

/** 飞书 / Lark 域名分组(spec §1) */
export type FeishuDomain = "feishu" | "lark"

const ENDPOINTS: Record<FeishuDomain, string> = {
  feishu: "https://accounts.feishu.cn",
  lark: "https://accounts.larksuite.com",
}

/** init 响应 — 拿 nonce */
export interface InitResponse {
  nonce: string
  supportedAuthMethods: string[]
}

/** begin 响应 — 拿 device_code + user_code(RFC 8628) */
export interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  /** verification 页面 URL(不带 user_code,user 输入) */
  verificationUri: string
  /** 直接二维码 URL(verification_uri + ?user_code=xxx) */
  verificationUriComplete: string
  /** 总有效期(秒,通常 3600) */
  expiresIn: number
  /** 推荐轮询间隔(秒,通常 5)*/
  interval: number
}

/** poll 成功响应 — 应用 + 主用户凭证 */
export interface PollSuccess {
  status: "success"
  /** 飞书自助创建的应用 appId */
  appId: string
  /** 应用 appSecret(明文,调用方负责落 SecretRef) */
  appSecret: string
  /** 主用户 openId */
  openId: string
  /** OAuth user_access_token(可选,后续 SDK 调用用) */
  accessToken?: string
  /** refresh_token(可选)*/
  refreshToken?: string
  /** access_token 有效期(秒,可选)*/
  expiresIn?: number
}

/** poll 中间态 / 失败 */
export type PollPending = { status: "pending"; nextIntervalMs?: number }
export type PollDenied = { status: "denied"; message?: string }
export type PollExpired = { status: "expired"; message?: string }
export type PollSlowDown = { status: "slow_down"; nextIntervalMs?: number }
export type PollError = { status: "error"; code: string; message?: string }

export type PollResult =
  | PollSuccess
  | PollPending
  | PollDenied
  | PollExpired
  | PollSlowDown
  | PollError

// ============================================================
// 错误
// ============================================================

export class OauthError extends Error {
  constructor(
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message)
    this.name = "OauthError"
  }
}

// ============================================================
// 内部:HTTP
// ============================================================

interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>
}

interface DoOptions {
  fetchImpl?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}

async function postForm<T = unknown>(
  url: string,
  params: Record<string, string>,
  options: DoOptions = {},
): Promise<{ status: number; body: T }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 15_000)
  const signal = options.signal
    ? mergeSignals(ctrl.signal, options.signal)
    : ctrl.signal

  const fetchImpl: FetchLike = options.fetchImpl ?? globalThis.fetch
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal,
    })
    let body: T
    try {
      body = (await res.json()) as T
    } catch (err) {
      throw new OauthError(`OAuth ${url} → non-JSON response`, err)
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a
  if (b.aborted) return b
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  a.addEventListener("abort", onAbort, { once: true })
  b.addEventListener("abort", onAbort, { once: true })
  return ctrl.signal
}

// ============================================================
// 解析辅助 — 飞书可能 snake_case / camelCase / data wrap,这里双向兜底
// ============================================================

type Loose = Record<string, unknown>

/** 从可能嵌 data 的 response 拿出 payload */
function unwrapData(raw: unknown): Loose {
  if (raw && typeof raw === "object") {
    const obj = raw as Loose
    if (obj.data && typeof obj.data === "object") {
      return obj.data as Loose
    }
    return obj
  }
  return {}
}

function pickStr(obj: Loose, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

function pickNum(obj: Loose, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return undefined
}

function pickStrArr(obj: Loose, ...keys: string[]): string[] | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v as string[]
    }
  }
  return undefined
}

// ============================================================
// public API
// ============================================================

/** 取域名 base URL */
export function endpointFor(domain: FeishuDomain): string {
  return ENDPOINTS[domain]
}

/**
 * Step 1:init — 拿 nonce(JWT,60 秒过期)。
 *
 * @throws OauthError 网络 / 解析 / HTTP 非 200 错误
 */
export async function init(
  domain: FeishuDomain,
  options: DoOptions = {},
): Promise<InitResponse> {
  const url = `${ENDPOINTS[domain]}/oauth/v1/app/registration`
  const { status, body } = await postForm<unknown>(url, { action: "init" }, options)
  if (status !== 200) {
    throw new OauthError(`init HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`)
  }
  const data = unwrapData(body)
  const nonce = pickStr(data, "nonce")
  if (!nonce) {
    throw new OauthError("init: nonce 字段缺失")
  }
  return {
    nonce,
    supportedAuthMethods: pickStrArr(data, "supported_auth_methods", "supportedAuthMethods") ?? [],
  }
}

/**
 * Step 2:begin — PersonalAgent archetype 注册,拿 device_code + user_code。
 *
 * @param domain 域名分组
 * @param nonce  init 拿到的 nonce(60 秒内用)
 */
export async function begin(
  domain: FeishuDomain,
  nonce: string,
  options: DoOptions = {},
): Promise<DeviceCodeResponse> {
  const url = `${ENDPOINTS[domain]}/oauth/v1/app/registration`
  const { status, body } = await postForm<unknown>(
    url,
    {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
      nonce,
    },
    options,
  )
  if (status !== 200) {
    throw new OauthError(`begin HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`)
  }
  const data = unwrapData(body)
  const deviceCode = pickStr(data, "device_code", "deviceCode")
  const userCode = pickStr(data, "user_code", "userCode")
  const verificationUri = pickStr(
    data,
    "verification_uri",
    "verification_url",
    "verificationUri",
    "verificationUrl",
    "url",
    "qr_url",
    "qrUrl",
  )
  const verificationUriComplete = pickStr(
    data,
    "verification_uri_complete",
    "verificationUriComplete",
  )
  const expiresIn = pickNum(data, "expires_in", "expiresIn") ?? 3600
  const interval = pickNum(data, "interval") ?? 5

  if (!deviceCode || !userCode || !verificationUri) {
    throw new OauthError(
      `begin: 缺关键字段 device_code/user_code/verification_uri,实际响应: ${JSON.stringify(body).slice(0, 200)}`,
    )
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: verificationUriComplete ?? `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expiresIn,
    interval,
  }
}

/**
 * Step 3:poll — 一次轮询。调用方负责按 interval 间隔重试 + 超时 / abort 控制。
 *
 * 不抛异常(网络错误除外):pending / expired / denied / slow_down / error 都用
 * 状态 enum 返回,调用方据此 switch。
 */
export async function poll(
  domain: FeishuDomain,
  deviceCode: string,
  nonce: string,
  options: DoOptions = {},
): Promise<PollResult> {
  const url = `${ENDPOINTS[domain]}/oauth/v1/app/registration`
  let status: number
  let body: unknown
  try {
    const r = await postForm<unknown>(
      url,
      { action: "poll", device_code: deviceCode, nonce },
      options,
    )
    status = r.status
    body = r.body
  } catch (err) {
    // 网络 / 超时 / abort —— 调用方决定要不要重试
    throw err instanceof OauthError ? err : new OauthError("poll fetch failed", err)
  }

  const data = unwrapData(body)

  // 飞书可能用 status 200 + error 字段(OAuth 2.0 错误响应风格),
  // 也可能用 status 4xx + error 字段。统一从 body 抽 error。
  const errorCode = pickStr(data, "error", "error_code", "errorCode")
  if (errorCode) {
    return mapErrorCode(errorCode, pickStr(data, "error_description", "message"))
  }

  // 成功:client_id + client_secret 必备(参 OpenClaw install-prompts.js line 96-110)
  // open_id 是 best-effort,可能在 user_info 嵌套对象内,可能 undefined
  const appId = pickStr(data, "client_id", "clientId", "app_id", "appId")
  const appSecret = pickStr(data, "client_secret", "clientSecret", "app_secret", "appSecret")
  // 优先从 user_info.open_id 取(飞书 PollResponse 真实结构),fallback 顶层
  const userInfo =
    data["user_info"] && typeof data["user_info"] === "object"
      ? (data["user_info"] as Loose)
      : null
  const openId =
    pickStr(userInfo ?? {}, "open_id", "openId") ??
    pickStr(data, "open_id", "openId", "user_open_id", "userOpenId")

  if (appId && appSecret) {
    return {
      status: "success",
      appId,
      appSecret,
      openId: openId ?? "",
      accessToken: pickStr(data, "access_token", "accessToken"),
      refreshToken: pickStr(data, "refresh_token", "refreshToken"),
      expiresIn: pickNum(data, "expires_in", "expiresIn"),
    }
  }

  // 既无 error,又无完整凭证 — 视作 pending(常见于飞书自定义 `code: 102` 等)
  if (status === 200) {
    return { status: "pending" }
  }
  return {
    status: "error",
    code: `http_${status}`,
    message: typeof body === "string" ? body : JSON.stringify(body).slice(0, 200),
  }
}

function mapErrorCode(code: string, message?: string): PollResult {
  switch (code) {
    case "authorization_pending":
    case "pending":
      return { status: "pending" }
    case "slow_down":
      return { status: "slow_down" }
    case "access_denied":
    case "denied":
      return { status: "denied", message }
    case "expired_token":
    case "expired":
      return { status: "expired", message }
    default:
      return { status: "error", code, message }
  }
}
