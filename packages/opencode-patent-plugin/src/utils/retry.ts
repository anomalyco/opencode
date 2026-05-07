/**
 * 通用重试工具
 *
 * 指数退避重试，用于 LLM API、数据库查询等可能因瞬态故障失败的操作。
 */

export interface RetryOptions {
  /** 最大重试次数（不含首次调用），默认 3 */
  maxRetries?: number
  /** 基础延迟（ms），默认 1000 */
  baseDelay?: number
  /** 判断错误是否可重试，默认匹配 429/500/502/503/504 和网络错误 */
  retryable?: (err: any) => boolean
}

/** 默认可重试条件：HTTP 429/5xx 或网络错误 */
function defaultRetryable(err: any): boolean {
  // HTTP 状态码判断
  const status = err?.status || err?.response?.status
  if (status === 429 || (status >= 500 && status <= 504)) return true

  // 网络错误
  const msg = String(err?.message || err || "")
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg)) return true

  // LLM API 特定错误信息
  if (/rate limit|too many requests|service unavailable|internal server error/i.test(msg)) return true

  return false
}

/**
 * 带指数退避的重试包装
 *
 * @example
 * ```ts
 * const result = await withRetry(() => fetch(url), { maxRetries: 3 })
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3
  const baseDelay = options?.baseDelay ?? 1000
  const isRetryable = options?.retryable ?? defaultRetryable

  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err

      // 最后一次或不可重试的错误，直接抛出
      if (attempt >= maxRetries || !isRetryable(err)) {
        throw err
      }

      // 指数退避：baseDelay * 2^attempt + 随机抖动
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay * 0.5
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed: ${err?.message}. Retrying in ${Math.round(delay)}ms...`)

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
