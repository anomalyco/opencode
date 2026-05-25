// [fork-only] opencode-cli HTTP client
// [feat: feishu-bridge] 2026-05-08
//
// adapter 调 opencode-cli sidecar 的 HTTP 接口:
//   - session 管理(create / abort / fork / summarize)
//   - 提交消息(prompt_async)
//   - SSE 订阅(message 更新 / permission 请求 / state 变化)
//   - permission 回应(approve / deny)
//
// 通信凭证:adapter 启动时由 Tauri 主进程通过 env var 注入:
//   OPENCODE_SERVER_URL  (e.g. http://127.0.0.1:54321)
//   OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD  (Basic auth,可选)

// ============================================================
// 类型
// ============================================================

export interface OpencodeClientOptions {
  /** opencode-cli serve 的 base URL */
  baseURL: string
  /** Basic auth(可选) */
  auth?: { username: string; password: string }
  /** 默认 timeout(ms) */
  timeoutMs?: number
  /**
   * opencode workspace directory — 通过 `x-opencode-directory` header 路由 instance。
   *
   * opencode 是多 instance 设计,每个 instance 跟 directory 绑死;不传此 header → "No context found"。
   * 飞书桥接默认用 `~/.opencode/imbot-workspace`(独立于 DeskFox 主窗口的 user-selected project)。
   */
  directory?: string
}

export interface SessionCreateRequest {
  /** 父 session id(可选,fork 时用) */
  parentID?: string
  /** session title */
  title?: string
}

export interface SessionCreateResponse {
  id: string
}

export interface PromptAsyncRequest {
  /** agent id(可选,opencode 默认) */
  agent?: string
  /** 消息文本(简化版,完整版含 parts) */
  text: string
  /** providerOptions(传 cwd 等给 spawn-based plugin) */
  providerOptions?: Record<string, unknown>
}

export interface PermissionRespondRequest {
  /** approve / deny */
  decision: "approve" | "deny"
  /** 可选拒绝原因 */
  reason?: string
}

export type SseEventHandler = (event: { event: string; data: unknown }) => void

// ============================================================
// 简单错误
// ============================================================

export class OpencodeClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = "OpencodeClientError"
  }
}

// ============================================================
// Client
// ============================================================

export class OpencodeClient {
  private readonly baseURL: string
  private readonly authHeader: string | null
  private readonly timeoutMs: number
  private readonly directoryHeader: string | null

  constructor(options: OpencodeClientOptions) {
    // 去掉末尾 /
    this.baseURL = options.baseURL.replace(/\/+$/, "")
    if (options.auth) {
      const token = btoa(`${options.auth.username}:${options.auth.password}`)
      this.authHeader = `Basic ${token}`
    } else {
      this.authHeader = null
    }
    this.timeoutMs = options.timeoutMs ?? 30_000
    // x-opencode-directory header 值(URL-encoded,跟 SDK 一致)
    this.directoryHeader = options.directory
      ? encodeURIComponent(options.directory)
      : null
  }

  /** 暴露 baseURL 给同包内 pipeline 模块自己拼 /event SSE 用 */
  get baseURLPublic(): string {
    return this.baseURL
  }

  /** 暴露 authHeader 给同包内 pipeline 模块用 */
  get authHeaderPublic(): string | null {
    return this.authHeader
  }

  /** 暴露 directory header(URL-encoded)给同包内 pipeline 模块用 */
  get directoryHeaderPublic(): string | null {
    return this.directoryHeader
  }

  /** 从 env var 构造(adapter 启动时主进程注入)*/
  static fromEnv(): OpencodeClient {
    const baseURL = process.env.OPENCODE_SERVER_URL
    if (!baseURL) {
      throw new OpencodeClientError("OPENCODE_SERVER_URL not set in env")
    }
    const username = process.env.OPENCODE_SERVER_USERNAME
    const password = process.env.OPENCODE_SERVER_PASSWORD
    return new OpencodeClient({
      baseURL,
      auth: username && password ? { username, password } : undefined,
    })
  }

  // ============================================================
  // 内部:HTTP
  // ============================================================

  private async request<T>(
    method: string,
    path: string,
    init?: { body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.authHeader) headers["Authorization"] = this.authHeader
    if (this.directoryHeader) headers["x-opencode-directory"] = this.directoryHeader

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    const signal = init?.signal
      ? mergeSignals(ctrl.signal, init.signal)
      : ctrl.signal

    try {
      const res = await fetch(`${this.baseURL}${path}`, {
        method,
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new OpencodeClientError(
          `${method} ${path} → ${res.status}`,
          res.status,
          body,
        )
      }
      // 204 No Content
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  // ============================================================
  // session
  // ============================================================

  async createSession(req: SessionCreateRequest = {}): Promise<SessionCreateResponse> {
    return this.request<SessionCreateResponse>("POST", "/session", { body: req })
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.request<void>("POST", `/session/${encodeURIComponent(sessionID)}/abort`)
  }

  async forkSession(sessionID: string): Promise<SessionCreateResponse> {
    return this.request<SessionCreateResponse>(
      "POST",
      `/session/${encodeURIComponent(sessionID)}/fork`,
    )
  }

  // ============================================================
  // prompt
  // ============================================================

  async promptAsync(sessionID: string, req: PromptAsyncRequest): Promise<void> {
    // 简化版:把 text 包成 part 数组(opencode 内部期望 parts[]
    //  完整版后续 Phase 再扩展支持多种 part 类型)
    const body = {
      agent: req.agent,
      parts: [{ type: "text", text: req.text }],
      providerOptions: req.providerOptions,
    }
    await this.request<void>("POST", `/session/${encodeURIComponent(sessionID)}/prompt_async`, {
      body,
    })
  }

  // ============================================================
  // permission
  // ============================================================

  async respondPermission(permissionID: string, req: PermissionRespondRequest): Promise<void> {
    await this.request<void>(
      "POST",
      `/permission/${encodeURIComponent(permissionID)}`,
      { body: req },
    )
  }

  // ============================================================
  // SSE 订阅 — fetch + ReadableStream 解析 text/event-stream
  // ============================================================

  /**
   * 订阅 session 的 SSE event stream。
   *
   * @returns { close } — 调 close() 终止订阅。
   */
  subscribeSession(
    sessionID: string,
    handler: SseEventHandler,
    options?: { signal?: AbortSignal },
  ): { close: () => void } {
    const ctrl = new AbortController()
    const signal = options?.signal
      ? mergeSignals(ctrl.signal, options.signal)
      : ctrl.signal

    const headers: Record<string, string> = { Accept: "text/event-stream" }
    if (this.authHeader) headers["Authorization"] = this.authHeader
    if (this.directoryHeader) headers["x-opencode-directory"] = this.directoryHeader

    void (async () => {
      try {
        const res = await fetch(
          `${this.baseURL}/session/${encodeURIComponent(sessionID)}/sse`,
          { headers, signal },
        )
        if (!res.ok || !res.body) {
          throw new OpencodeClientError(
            `SSE subscribe ${sessionID} → ${res.status}`,
            res.status,
          )
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ""
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += value
          // SSE 协议:event 之间用空行分隔
          let eolIdx
          while ((eolIdx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, eolIdx)
            buffer = buffer.slice(eolIdx + 2)
            const parsed = parseSseChunk(chunk)
            if (parsed) {
              try {
                handler(parsed)
              } catch (err) {
                console.error("[opencode-client] SSE handler error", err)
              }
            }
          }
        }
      } catch (err) {
        if (signal.aborted) return // 主动 close,不报
        console.error("[opencode-client] SSE stream error", err)
      }
    })()

    return { close: () => ctrl.abort() }
  }
}

// ============================================================
// 辅助
// ============================================================

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a
  if (b.aborted) return b
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  a.addEventListener("abort", onAbort, { once: true })
  b.addEventListener("abort", onAbort, { once: true })
  return ctrl.signal
}

/**
 * 解析单个 SSE chunk(`event: ...\ndata: ...`)→ { event, data }
 *
 * 返 null 表示 chunk 不完整或无效(注释行 / 空 chunk)。
 */
export function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
  let event = "message"
  const dataLines: string[] = []
  for (const line of chunk.split("\n")) {
    if (!line || line.startsWith(":")) continue // 注释 / 空行
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const field = line.slice(0, colon)
    // SSE 规范:冒号后跟 1 个空格(可选)
    const value = line.slice(colon + 1).replace(/^ /, "")
    if (field === "event") event = value
    else if (field === "data") dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  const dataStr = dataLines.join("\n")
  let data: unknown
  try {
    data = JSON.parse(dataStr)
  } catch {
    data = dataStr // 非 JSON,留原 string
  }
  return { event, data }
}
