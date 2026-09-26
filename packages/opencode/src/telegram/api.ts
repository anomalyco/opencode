export interface TelegramUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramChat {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramMessage {
  message_id: number
  text?: string
  caption?: string
  from?: TelegramUser
  chat: TelegramChat
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface ApiResponse<T> {
  ok: boolean
  result: T
}

interface RateLimitBody {
  parameters?: { retry_after?: number }
}

export interface ApiOptions {
  botToken: string
  baseUrl?: string
}

export interface SendOptions {
  parseMode?: "HTML"
}

export class ApiError extends Error {}

const RATE_LIMIT_MAX_WAIT_SECONDS = 30

export class TelegramApi {
  private readonly token: string
  readonly baseUrl: string

  constructor(opts: ApiOptions) {
    this.token = opts.botToken
    this.baseUrl = opts.baseUrl ?? "https://api.telegram.org"
  }

  async getMe(): Promise<TelegramUser> {
    return this.call("getMe")
  }

  async getUpdates(input: { timeout: number; offset: number }): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", {
      timeout: input.timeout,
      offset: input.offset,
      allowed_updates: ["message"],
    })
  }

  async sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<{ message_id: number }> {
    return this.call("sendMessage", serializeText({ chat_id: chatId, text }, opts))
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: SendOptions,
  ): Promise<{ message_id: number }> {
    return this.call("editMessageText", serializeText({ chat_id: chatId, message_id: messageId, text }, opts))
  }

  private async call<T>(method: string, payload?: Record<string, unknown>, allowRetry = true): Promise<T> {
    const res = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : "{}",
    })
    if (res.status === 429 && allowRetry) {
      const body = (await res.json().catch(() => undefined)) as RateLimitBody | undefined
      const seconds = Math.min(body?.parameters?.retry_after ?? 1, RATE_LIMIT_MAX_WAIT_SECONDS)
      await Bun.sleep(seconds * 1000)
      return this.call(method, payload, false)
    }
    if (!res.ok) throw new ApiError(`Telegram API ${method} failed: HTTP ${res.status}`)
    const data = (await res.json()) as ApiResponse<T>
    if (!data.ok) throw new ApiError(`Telegram API ${method} failed`)
    return data.result
  }
}

function serializeText(payload: Record<string, unknown>, opts?: SendOptions): Record<string, unknown> {
  if (!opts?.parseMode) return payload
  return { ...payload, parse_mode: opts.parseMode }
}
