/**
 * ============================================================================
 * 文件名：retry.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供异步操作的自动重试机制。
 * 当网络请求或异步操作可能因暂时性错误而失败时，此模块可以自动重试操作，
 * 使用指数退避策略避免过度请求服务器。
 *
 * 主要功能：
 * - 自动重试：在失败时自动重试异步操作
 * - 指数退避：每次重试的延迟时间指数增长，减轻服务器压力
 * - 可配置：支持自定义重试次数、延迟时间、退避因子等
 * - 智能判断：识别暂时性错误，只对可重试的错误进行重试
 *
 * 依赖关系：
 * - 无外部依赖，仅使用 JavaScript 内置 Promise 和 setTimeout
 *
 * 导出内容：
 * - RetryOptions：重试配置选项接口
 * - retry：重试函数，接收异步函数并返回带重试的 Promise
 * - isTransientError：内部函数，判断错误是否为暂时性错误
 *
 * 使用场景：
 * - 网络请求失败重试
 * - API 调用容错处理
 * - 数据库连接重试
 * - 任何可能因暂时性错误失败的异步操作
 *
 * @package util
 * @module retry
 */

/**
 * 重试配置选项接口
 *
 * 定义 retry 函数的配置参数，所有参数都是可选的。
 *
 * @property attempts - 最大重试次数，默认为 3
 *                      包括首次尝试，所以总共会执行 attempts 次
 * @property delay - 初始延迟时间（毫秒），默认为 500 毫秒
 *                   第一次重试前的等待时间
 * @property factor - 退避因子，默认为 2
 *                    每次重试的延迟时间会乘以这个因子，实现指数退避
 *                    例如：delay=500, factor=2 时，延迟序列为 500, 1000, 2000...
 * @property maxDelay - 最大延迟时间（毫秒），默认为 10000 毫秒（10秒）
 *                      防止延迟时间无限增长，确保重试在合理时间内完成
 * @property retryIf - 判断是否应该重试的函数，默认为 isTransientError
 *                    接收错误对象，返回 true 表示应该重试，false 表示直接抛出错误
 */
export interface RetryOptions {
  // 最大重试次数，包括首次尝试
  // 例如：attempts=3 表示首次尝试 + 最多 2 次重试
  attempts?: number

  // 初始延迟时间（毫秒），第一次重试前的等待时间
  delay?: number

  // 退避因子，每次重试延迟时间的增长倍数
  // factor=2 表示每次延迟翻倍（指数退避）
  factor?: number

  // 最大延迟时间（毫秒），防止延迟时间过长
  maxDelay?: number

  // 自定义判断函数，决定是否应该重试
  // 返回 true 表示重试，false 表示直接抛出错误
  retryIf?: (error: unknown) => boolean
}

/**
 * 暂时性错误消息列表
 *
 * 包含常见暂时性错误的关键词，用于判断错误是否可以重试。
 * 这些错误通常是网络或暂时性问题，重试可能成功。
 *
 * 包含的错误类型：
 * - "load failed"：资源加载失败
 * - "network connection was lost"：网络连接丢失
 * - "network request failed"：网络请求失败
 * - "failed to fetch"：fetch API 失败
 * - "econnreset"：连接被重置（常见于服务器断开连接）
 * - "econnrefused"：连接被拒绝（常见于服务器未响应）
 * - "etimedout"：连接超时
 * - "socket hang up"：套接字挂起
 */
const TRANSIENT_MESSAGES = [
  // 资源加载失败的错误消息
  "load failed",

  // 网络连接问题相关错误
  "network connection was lost", // 网络连接丢失
  "network request failed",      // 网络请求失败
  "failed to fetch",             // fetch API 失败

  // 常见的网络错误代码（小写，因为会转换为小写比较）
  "econnreset",    // 连接被重置
  "econnrefused",  // 连接被拒绝
  "etimedout",     // 连接超时

  // 套接字相关错误
  "socket hang up", // 套接字挂起
]

/**
 * 判断错误是否为暂时性错误
 *
 * 通过检查错误消息是否包含已知的暂时性错误关键词来判断。
 * 暂时性错误通常是由网络波动、服务器临时不可用等引起的，
 * 重试可能成功，因此应该进行重试。
 *
 * @param error - 错误对象，可能是 Error 实例或其他类型
 * @returns 如果是暂时性错误返回 true，否则返回 false
 *
 * 判断逻辑：
 * 1. 如果错误为空或 undefined，返回 false（不重试）
 * 2. 提取错误消息：
 *    - 如果是 Error 实例，使用 error.message
 *    - 否则将错误转换为字符串
 * 3. 将消息转换为小写（不区分大小写匹配）
 * 4. 检查消息是否包含任何暂时性错误关键词
 *
 * 使用场景：
 * - 作为 retry 函数的默认 retryIf 参数
 * - 自定义重试逻辑时参考
 */
function isTransientError(error: unknown): boolean {
  // 如果错误为空（null 或 undefined），不重试
  // 空错误通常表示程序逻辑问题，重试无法解决
  if (!error) return false

  // 提取错误消息字符串
  // 如果是 Error 实例，使用 message 属性
  // 否则将整个错误转换为字符串
  const message = String(error instanceof Error ? error.message : error).toLowerCase()

  // 检查消息是否包含任何已知的暂时性错误关键词
  // some() 方法会在数组中找到第一个匹配的元素后返回 true
  return TRANSIENT_MESSAGES.some((m) => message.includes(m))
}

/**
 * 异步重试函数
 *
 * 对异步函数进行包装，在失败时自动重试，使用指数退避策略。
 * 这是模块的核心导出函数，提供了灵活的配置选项。
 *
 * @template T - 异步函数的返回值类型
 * @param fn - 需要重试的异步函数，返回 Promise
 * @param options - 重试配置选项，所有参数都有默认值
 * @returns Promise，成功时返回函数结果，失败时抛出最后一次错误
 *
 * 重试逻辑：
 * 1. 解构配置选项，使用默认值填充未提供的选项
 * 2. 循环尝试执行函数，最多执行 attempts 次
 * 3. 每次尝试：
 *    a. 尝试执行函数，成功则返回结果
 *    b. 失败则捕获错误
 *    c. 判断是否应该重试：
 *       - 如果是最后一次尝试，直接抛出错误
 *       - 如果 retryIf 返回 false，直接抛出错误
 *    d. 计算等待时间（指数退避，但不超过 maxDelay）
 *    e. 等待后进行下一次尝试
 * 4. 如果所有尝试都失败，抛出最后一次的错误
 *
 * 指数退避计算：
 * waitTime = min(delay * factor^attempt, maxDelay)
 * 例如：delay=500, factor=2, maxDelay=10000
 * - 第1次重试（attempt=0）：500ms
 * - 第2次重试（attempt=1）：1000ms
 * - 第3次重试（attempt=2）：2000ms
 * - 第4次重试（attempt=3）：4000ms
 * - 第5次重试（attempt=4）：8000ms
 * - 第6次重试（attempt=5）：10000ms（达到最大值）
 *
 * 使用场景：
 * - 网络请求重试
 * - API 调用容错
 * - 不稳定的连接重试
 *
 * @example
 * ```typescript
 * // 使用默认配置重试 3 次
 * const result = await retry(() => fetch("https://api.example.com/data"))
 *
 * // 自定义重试配置
 * const result = await retry(
 *   () => fetch("https://api.example.com/data"),
 *   {
 *     attempts: 5,      // 最多尝试 5 次
 *     delay: 1000,      // 初始延迟 1 秒
 *     factor: 2,        // 每次延迟翻倍
 *     maxDelay: 30000,  // 最大延迟 30 秒
 *   }
 * )
 *
 * // 自定义重试条件
 * const result = await retry(
 *   () => fetch("https://api.example.com/data"),
 *   {
 *     retryIf: (error) => {
 *       // 只在 5xx 错误时重试
 *       return error.message.includes("500")
 *     }
 *   }
 * )
 * ```
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  // 解构配置选项，设置默认值
  // - attempts=3：最多尝试 3 次（首次 + 2 次重试）
  // - delay=500：初始延迟 500 毫秒
  // - factor=2：每次延迟翻倍
  // - maxDelay=10000：最大延迟 10 秒
  // - retryIf=isTransientError：使用默认的暂时性错误判断函数
  const { attempts = 3, delay = 500, factor = 2, maxDelay = 10000, retryIf = isTransientError } = options

  // 保存最后一次的错误，用于在所有尝试失败后抛出
  let lastError: unknown

  // 循环尝试执行函数，最多执行 attempts 次
  // attempt 从 0 开始，表示当前是第几次尝试（0-based）
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // 尝试执行异步函数
      // 如果成功，直接返回结果，不再重试
      return await fn()

    } catch (error) {
      // 捕获错误，保存为最后一次错误
      lastError = error

      // 检查是否应该进行重试
      // - 如果是最后一次尝试（attempt === attempts - 1），不再重试
      // - 如果 retryIf 返回 false，表示不应该重试此错误
      if (attempt === attempts - 1 || !retryIf(error)) throw error

      // 计算本次重试前的等待时间
      // 使用指数退避：delay * factor^attempt
      // Math.min 确保不超过 maxDelay
      const wait = Math.min(delay * Math.pow(factor, attempt), maxDelay)

      // 等待指定时间后进行下一次尝试
      // 创建一个在 wait 毫秒后 resolve 的 Promise
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }

  // 如果所有尝试都失败，抛出最后一次的错误
  // 这行代码理论上不应该执行到，因为会在循环中抛出
  throw lastError
}
