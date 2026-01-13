/**
 * ============================================================================
 * 文件名：retry.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话重试模块。处理 LLM 请求失败时的重试逻辑，
 * 包括指数退避延迟计算和可重试错误判断。
 *
 * 主要功能：
 * - sleep(ms, signal)：可中断的延迟函数
 * - delay(attempt, error?)：计算重试延迟时间
 * - retryable(error)：判断错误是否可重试
 *
 * 依赖关系：
 * - @opencode-ai/util/error：命名错误类型
 * - ./message-v2：消息模型和 API 错误类型
 *
 * 导出内容：
 * - SessionRetry namespace：重试管理命名空间
 *   - RETRY_INITIAL_DELAY：初始重试延迟（2000ms）
 *   - RETRY_BACKOFF_FACTOR：退避因子（2）
 *   - RETRY_MAX_DELAY_NO_HEADERS：无头部时的最大延迟
 *   - RETRY_MAX_DELAY：最大延迟（32位有符号整数最大值）
 *   - sleep()：可中断的延迟
 *   - delay()：计算重试延迟
 *   - retryable()：判断是否可重试
 *
 * 重试策略：
 * 1. 初始延迟 2 秒
 * 2. 每次重试延迟翻倍（指数退避）
 * 3. 优先使用响应头中的 retry-after 指示
 * 4. 最大延迟不超过 32 位有符号整数限制
 *
 * @package opencode
 * @module session/retry
 */

// 导入命名错误类型
import type { NamedError } from "@opencode-ai/util/error"

// 导入消息模型
import { MessageV2 } from "./message-v2"

/**
 * 会话重试命名空间
 *
 * 处理 LLM 请求失败时的重试逻辑。
 */
export namespace SessionRetry {
  /**
   * 初始重试延迟
   *
   * 首次重试前等待 2 秒。
   */
  export const RETRY_INITIAL_DELAY = 2000

  /**
   * 退避因子
   *
   * 每次重试延迟乘以这个因子（指数退避）。
   */
  export const RETRY_BACKOFF_FACTOR = 2

  /**
   * 无头部时的最大延迟
   *
   * 当响应中没有 retry-after 头部时的最大延迟（30 秒）。
   */
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 秒

  /**
   * 最大延迟
   *
   * setTimeout 的最大延迟值（32 位有符号整数最大值，约 24.8 天）。
   */
  export const RETRY_MAX_DELAY = 2_147_483_647 // setTimeout 的最大 32 位有符号整数

  /**
   * 可中断的延迟函数
   *
   * 在指定的毫秒数后解析 Promise，但如果中止信号被触发则立即拒绝。
   *
   * @param ms - 延迟毫秒数
   * @param signal - 中止信号
   * @returns Promise
   *
   * 用途：
   * - 重试前等待，但允许用户中断
   * - 实现可取消的重试延迟
   */
  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // 中止处理器
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }

      // 设置超时（确保不超过最大延迟）
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )

      // 监听中止信号
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  /**
   * 计算重试延迟
   *
   * 根据重试次数和错误信息计算延迟时间。
   * 优先使用响应头中的 retry-after 指示，否则使用指数退避。
   *
   * @param attempt - 重试次数（从 1 开始）
   * @param error - 可选的 API 错误对象
   * @returns 延迟毫秒数
   *
   * 计算逻辑：
   * 1. 如果有 API 错误且包含 retry-after-ms 头部，直接使用
   * 2. 如果有 retry-after 头部：
   *    - 尝试解析为数字（秒）
   *    - 尝试解析为 HTTP 日期
   *    - 否则使用默认计算
   * 3. 否则使用指数退避：初始延迟 * 退避因子^(次数-1)
   * 4. 确保不超过最大延迟
   */
  export function delay(attempt: number, error?: MessageV2.APIError) {
    // 如果有 API 错误，检查响应头
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        // 优先使用 retry-after-ms 头部（毫秒）
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        // 其次使用 retry-after 头部（秒）
        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          // 尝试解析为数字（秒）
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // 转换为毫秒
            return Math.ceil(parsedSeconds * 1000)
          }

          // 尝试解析为 HTTP 日期格式
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        // 如果有错误但无法解析头部，使用默认计算
        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    // 没有错误或头部，使用指数退避（限制最大值）
    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  /**
   * 判断错误是否可重试
   *
   * 分析错误对象，判断是否应该重试请求。
   *
   * @param error - 错误对象
   * @returns 重试原因字符串，如果不可重试则返回 undefined
   *
   * 可重试错误类型：
   * 1. APIError 且 isRetryable=true：
   *    - "Provider is overloaded"（包含 "Overloaded"）
   *    - 错误消息本身
   * 2. 错误消息包含特定 JSON 格式：
   *    - "Too Many Requests"（too_many_requests）
   *    - "Provider is overloaded"（exhausted/unavailable）
   *    - "Rate Limited"（rate_limit）
   *    - "Provider Server Error"（no_kv_space/server_error）
   */
  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // 检查是否为 APIError
    if (MessageV2.APIError.isInstance(error)) {
      // 如果不可重试，返回 undefined
      if (!error.data.isRetryable) return undefined

      // 检查是否为过载错误
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    // 检查错误消息中是否包含 JSON
    if (typeof error.data?.message === "string") {
      try {
        const json = JSON.parse(error.data.message)

        // too_many_requests 错误
        if (json.type === "error" && json.error?.type === "too_many_requests") {
          return "Too Many Requests"
        }

        // exhausted/unavailable 错误
        if (json.code.includes("exhausted") || json.code.includes("unavailable")) {
          return "Provider is overloaded"
        }

        // rate_limit 错误
        if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
          return "Rate Limited"
        }

        // 服务器错误（包括 no_kv_space）
        if (
          json.error?.message?.includes("no_kv_space") ||
          (json.type === "error" && json.error?.type === "server_error") ||
          !!json.error
        ) {
          return "Provider Server Error"
        }
      } catch {
        // JSON 解析失败，忽略
      }
    }

    // 不是可重试错误
    return undefined
  }
}
