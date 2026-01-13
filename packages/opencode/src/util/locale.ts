/**
 * ============================================================================
 * 文件名：locale.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 本地化工具模块。提供日期、时间、数字等本地化格式化功能。
 *
 * 主要功能：
 * - titlecase()：将字符串转换为标题格式
 * - time()：格式化时间为短格式
 * - datetime()：格式化日期和时间
 * - todayTimeOrDateTime()：智能显示时间或日期时间
 * - number()：格式化数字（K/M 单位）
 * - duration()：格式化时间长度
 * - truncate()：截断字符串
 * - truncateMiddle()：从中间截断字符串
 * - pluralize()：复数化处理
 *
 * 依赖关系：
 * - 无外部依赖（使用内置 Intl API）
 *
 * 导出内容：
 * - Locale namespace：本地化命名空间
 *   - titlecase(str)：标题格式
 *   - time(input)：时间格式
 *   - datetime(input)：日期时间格式
 *   - todayTimeOrDateTime(input)：智能日期时间
 *   - number(num)：数字格式
 *   - duration(input)：时长格式
 *   - truncate(str, len)：截断字符串
 *   - truncateMiddle(str, maxLength)：中间截断
 *   - pluralize(count, singular, plural)：复数化
 *
 * 使用场景：
 * - UI 显示的日期和时间
 * - 日志输出的时间戳
 * - 文件大小的显示
 * - 操作耗时的显示
 * - 文本长度的限制
 *
 * 使用示例：
 * ```typescript
 * // 标题格式
 * Locale.titlecase("hello world")  // "Hello World"
 *
 * // 时间格式
 * Locale.time(Date.now())  // "2:30 PM"
 *
 * // 日期时间格式
 * Locale.datetime(Date.now())  // "2:30 PM · 1/15/2025"
 *
 * // 智能日期时间
 * Locale.todayTimeOrDateTime(todayTime)  // "2:30 PM"
 * Locale.todayTimeOrDateTime(yesterdayTime)  // "2:30 PM · 1/14/2025"
 *
 * // 数字格式
 * Locale.number(500)    // "500"
 * Locale.number(1500)   // "1.5K"
 * Locale.number(2500000)  // "2.5M"
 *
 * // 时长格式
 * Locale.duration(500)     // "500ms"
 * Locale.duration(5000)    // "5.0s"
 * Locale.duration(65000)   // "1m 5s"
 * Locale.duration(4000000) // "1h 6m"
 * Locale.duration(100000000)  // "1d 3h"
 *
 * // 字符串截断
 * Locale.truncate("hello world", 8)  // "hello w…"
 * Locale.truncateMiddle("very-long-filename.txt", 20)  // "very-l…ame.txt"
 *
 * // 复数化
 * Locale.pluralize(1, "{} item", "{} items")  // "1 item"
 * Locale.pluralize(5, "{} item", "{} items")  // "5 items"
 * ```
 *
 * 本地化：
 * - 使用 Intl.DateTimeFormat API
 * - 自动适配用户的语言环境
 * - 时间格式：short（如 2:30 PM）
 * - 日期格式：本地格式（如 1/15/2025）
 *
 * @package opencode
 * @module util/locale
 */

/**
 * 本地化命名空间
 *
 * 提供各种本地化和格式化功能。
 */
export namespace Locale {
  /**
   * 将字符串转换为标题格式
   *
   * 将每个单词的首字母大写。
   *
   * @param str - 要转换的字符串
   * @returns 标题格式的字符串
   *
   * 实现方式：
   * - 使用正则表达式 \b\w 匹配单词边界后的字母
   * - 将匹配的字母转为大写
   *
   * @example
   * ```typescript
   * Locale.titlecase("hello world")  // "Hello World"
   * Locale.titlecase("foo bar baz")  // "Foo Bar Baz"
   * ```
   */
  export function titlecase(str: string) {
    // \b：单词边界
    // \w：单词字符（字母、数字、下划线）
    // 将每个单词的首字母大写
    return str.replace(/\b\w/g, (c) => c.toUpperCase())
  }

  /**
   * 格式化时间为短格式
   *
   * 使用本地化的时间格式显示。
   *
   * @param input - 时间戳（毫秒）
   * @returns 格式化的时间字符串
   *
   * 格式说明：
   * - timeStyle: "short"：短格式时间
   * - 示例：2:30 PM（美国）、14:30（欧洲）
   * - 自动适配用户的语言环境
   *
   * @example
   * ```typescript
   * Locale.time(Date.now())  // "2:30 PM"（取决于地区）
   * ```
   */
  export function time(input: number): string {
    const date = new Date(input)
    // 使用 Intl API 格式化时间，短格式
    return date.toLocaleTimeString(undefined, { timeStyle: "short" })
  }

  /**
   * 格式化日期和时间
   *
   * 组合时间和日期，用中间点分隔。
   *
   * @param input - 时间戳（毫秒）
   * @returns 格式化的日期时间字符串
   *
   * 格式说明：
   * - 时间：短格式（如 2:30 PM）
   * - 日期：本地格式（如 1/15/2025）
   * - 分隔符：中间点（·）
   *
   * @example
   * ```typescript
   * Locale.datetime(Date.now())  // "2:30 PM · 1/15/2025"
   * ```
   */
  export function datetime(input: number): string {
    const date = new Date(input)
    // 获取短格式时间
    const localTime = time(input)
    // 获取本地格式日期
    const localDate = date.toLocaleDateString()
    // 用中间点连接
    return `${localTime} · ${localDate}`
  }

  /**
   * 智能显示时间或日期时间
   *
   * 如果是今天，只显示时间；否则显示日期时间。
   *
   * @param input - 时间戳（毫秒）
   * @returns 格式化的字符串
   *
   * 判断逻辑：
   * - 比较年、月、日是否相同
   * - 相同：只显示时间（如 2:30 PM）
   * - 不同：显示完整日期时间（如 2:30 PM · 1/14/2025）
   *
   * @example
   * ```typescript
   * // 今天的日期
   * Locale.todayTimeOrDateTime(Date.now())  // "2:30 PM"
   *
   * // 昨天的日期
   * Locale.todayTimeOrDateTime(yesterday)   // "2:30 PM · 1/14/2025"
   * ```
   */
  export function todayTimeOrDateTime(input: number): string {
    const date = new Date(input)
    const now = new Date()

    // 检查是否是今天（年、月、日都相同）
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    if (isToday) {
      // 今天的日期只显示时间
      return time(input)
    } else {
      // 其他日期显示完整日期时间
      return datetime(input)
    }
  }

  /**
   * 格式化数字（K/M 单位）
   *
   * 将大数字转换为更易读的格式。
   *
   * @param num - 要格式化的数字
   * @returns 格式化的字符串
   *
   * 格式规则：
   * - ≥ 1,000,000：显示为 M（百万）
   * - ≥ 1,000：显示为 K（千）
   * - < 1,000：显示原数字
   *
   * @example
   * ```typescript
   * Locale.number(500)      // "500"
   * Locale.number(1500)     // "1.5K"
   * Locale.number(2500000)  // "2.5M"
   * ```
   */
  export function number(num: number): string {
    // 百万级别
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    }
    // 千级别
    else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    // 小于千的数字
    return num.toString()
  }

  /**
   * 格式化时间长度
   *
   * 将毫秒数转换为易读的时间格式。
   *
   * @param input - 时间长度（毫秒）
   * @returns 格式化的字符串
   *
   * 格式规则：
   * - < 1 秒：显示毫秒（如 500ms）
   * - < 1 分钟：显示秒（如 5.0s）
   * - < 1 小时：显示分钟和秒（如 1m 5s）
   * - < 1 天：显示小时和分钟（如 1h 6m）
   * - ≥ 1 天：显示天数和小时（如 1d 3h）
   *
   * @example
   * ```typescript
   * Locale.duration(500)        // "500ms"
   * Locale.duration(5000)       // "5.0s"
   * Locale.duration(65000)      // "1m 5s"
   * Locale.duration(4000000)    // "1h 6m"
   * Locale.duration(100000000)  // "1d 3h"
   * ```
   */
  export function duration(input: number) {
    // 小于 1 秒，显示毫秒
    if (input < 1000) {
      return `${input}ms`
    }
    // 小于 1 分钟，显示秒
    if (input < 60000) {
      return `${(input / 1000).toFixed(1)}s`
    }
    // 小于 1 小时，显示分钟和秒
    if (input < 3600000) {
      const minutes = Math.floor(input / 60000)           // 完整分钟数
      const seconds = Math.floor((input % 60000) / 1000)  // 剩余秒数
      return `${minutes}m ${seconds}s`
    }
    // 小于 1 天，显示小时和分钟
    if (input < 86400000) {
      const hours = Math.floor(input / 3600000)           // 完整小时数
      const minutes = Math.floor((input % 3600000) / 60000)  // 剩余分钟数
      return `${hours}h ${minutes}m`
    }
    // 大于等于 1 天，显示天数和小时
    const hours = Math.floor(input / 3600000)             // 总小时数
    const days = Math.floor((input % 3600000) / 86400000)  // 完整天数
    return `${days}d ${hours}h`
  }

  /**
   * 截断字符串
   *
   * 如果字符串超过指定长度，从末尾截断并添加省略号。
   *
   * @param str - 要截断的字符串
   * @param len - 最大长度
   * @returns 截断后的字符串
   *
   * @example
   * ```typescript
   * Locale.truncate("hello world", 8)  // "hello w…"
   * Locale.truncate("short", 10)       // "short"（不截断）
   * ```
   */
  export function truncate(str: string, len: number): string {
    // 如果长度不超过限制，返回原字符串
    if (str.length <= len) return str
    // 截断并添加省略号
    return str.slice(0, len - 1) + "…"
  }

  /**
   * 从中间截断字符串
   *
   * 如果字符串超过指定长度，从中间截断，保留首尾部分。
   *
   * @param str - 要截断的字符串
   * @param maxLength - 最大长度（默认 35）
   * @returns 截断后的字符串
   *
   * 截断策略：
   * - 计算省略号（…）占用的 1 个字符
   * - 前半部分：(maxLength - 1) / 2 向上取整
   * - 后半部分：(maxLength - 1) / 2 向下取整
   * - 前半部分可能比后半部分多一个字符（奇数长度）
   *
   * @example
   * ```typescript
   * Locale.truncateMiddle("very-long-filename.txt", 20)
   * // "very-l…ame.txt"
   *
   * Locale.truncateMiddle("short", 10)
   * // "short"（不截断）
   * ```
   */
  export function truncateMiddle(str: string, maxLength: number = 35): string {
    // 如果长度不超过限制，返回原字符串
    if (str.length <= maxLength) return str

    // 省略号
    const ellipsis = "…"

    // 前半部分长度（向上取整）
    const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)

    // 后半部分长度（向下取整）
    const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

    // 拼接：前半部分 + 省略号 + 后半部分
    return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
  }

  /**
   * 复数化处理
   *
   * 根据数量选择单数或复数形式。
   *
   * @param count - 数量
   * @param singular - 单数模板（使用 {} 占位符）
   * @param plural - 复数模板（使用 {} 占位符）
   * @returns 格式化后的字符串
   *
   * 模板格式：
   * - 使用 {} 作为占位符
   * - 会被替换为实际的数量
   *
   * @example
   * ```typescript
   * Locale.pluralize(1, "{} item", "{} items")   // "1 item"
   * Locale.pluralize(5, "{} item", "{} items")   // "5 items"
   * Locale.pluralize(0, "{} item", "{} items")   // "0 items"
   * ```
   */
  export function pluralize(count: number, singular: string, plural: string): string {
    // 根据数量选择模板
    const template = count === 1 ? singular : plural
    // 替换占位符
    return template.replace("{}", count.toString())
  }
}
