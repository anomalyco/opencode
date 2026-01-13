/**
 * ============================================================================
 * 文件名：log.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 日志系统模块。提供结构化的日志记录功能，支持多级别日志、标签、计时和文件输出。
 *
 * 主要功能：
 * - 支持多级别日志（DEBUG、INFO、WARN、ERROR）
 * - 日志级别过滤和优先级控制
 * - 结构化日志标签（key=value 格式）
 * - Logger 克隆和继承
 * - 计时功能（支持 using 声明）
 * - 文件和控制台双输出
 * - 自动日志文件清理
 * - Error 对象的递归格式化（包含 cause 链）
 *
 * 依赖关系：
 * - path：路径处理
 * - fs/promises：文件系统操作
 * - ../global：全局路径配置
 * - zod：类型验证
 *
 * 导出内容：
 * - Log namespace：日志系统主命名空间
 *   - Level：日志级别枚举类型
 *   - Logger：Logger 接口定义
 *   - Options：日志选项接口
 *   - init(options)：初始化日志系统
 *   - file()：获取当前日志文件路径
 *   - create(tags)：创建新的 Logger 实例
 *   - Default：默认 Logger 实例
 *
 * 日志格式：
 * [时间戳] [+耗时ms] [标签1=值1 标签2=值2] 消息内容
 *
 * 使用示例：
 * ```typescript
 * const log = Log.create({ service: "my-service" })
 * log.info("启动服务", { port: 3000 })
 * log.error("发生错误", { error: new Error("...") })
 *
 * // 使用计时功能
 * {
 *   const timer = log.time("处理数据")
 *   // ... 执行操作
 *   timer.stop()
 * }
 *
 * // 使用 using 声明（自动停止）
 * {
 *   using timer = log.time("处理数据")
 *   // ... 执行操作
 * }  // 自动调用 stop()
 * ```
 *
 * @package opencode
 * @module util/log
 */

// 导入路径处理模块
import path from "path"

// 导入文件系统操作模块
import fs from "fs/promises"

// 导入全局配置
import { Global } from "../global"

// 导入 Zod 类型验证库
import z from "zod"

/**
 * 日志系统命名空间
 *
 * 包含所有日志相关的类型、函数和配置。
 */
export namespace Log {
  /**
   * 日志级别枚举
   *
   * 使用 Zod 定义，支持运行时验证。
   * 级别从低到高：DEBUG < INFO < WARN < ERROR
   */
  export const Level = z
    .enum(["DEBUG", "INFO", "WARN", "ERROR"])
    .meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  /**
   * 日志级别优先级映射
   *
   * 数字越小优先级越高。
   * 用于比较和过滤日志输出。
   */
  const levelPriority: Record<Level, number> = {
    DEBUG: 0,  // 最高优先级（最详细）
    INFO: 1,   // 普通信息
    WARN: 2,   // 警告信息
    ERROR: 3,  // 错误信息（最低优先级）
  }

  /**
   * 当前全局日志级别
   *
   * 只有优先级 >= 此级别的日志才会被输出。
   * 默认级别：INFO
   */
  let level: Level = "INFO"

  /**
   * 判断是否应该输出日志
   *
   * 比较输入日志级别与当前全局日志级别的优先级。
   *
   * @param input - 要判断的日志级别
   * @returns 是否应该输出此级别的日志
   */
  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level]
  }

  /**
   * Logger 接口定义
   *
   * 定义了 Logger 实例必须实现的方法。
   */
  export type Logger = {
    /**
     * 输出 DEBUG 级别日志
     * @param message - 日志消息
     * @param extra - 额外的结构化数据
     */
    debug(message?: any, extra?: Record<string, any>): void

    /**
     * 输出 INFO 级别日志
     * @param message - 日志消息
     * @param extra - 额外的结构化数据
     */
    info(message?: any, extra?: Record<string, any>): void

    /**
     * 输出 ERROR 级别日志
     * @param message - 日志消息
     * @param extra - 额外的结构化数据
     */
    error(message?: any, extra?: Record<string, any>): void

    /**
     * 输出 WARN 级别日志
     * @param message - 日志消息
     * @param extra - 额外的结构化数据
     */
    warn(message?: any, extra?: Record<string, any>): void

    /**
     * 添加标签到 Logger
     * 标签会自动添加到所有后续日志
     * @param key - 标签键
     * @param value - 标签值
     * @returns 当前 Logger 实例（支持链式调用）
     */
    tag(key: string, value: string): Logger

    /**
     * 克隆当前 Logger
     * 创建一个具有相同标签的新 Logger
     * @returns 新的 Logger 实例
     */
    clone(): Logger

    /**
     * 创建计时器
     * 记录操作的开始和结束时间
     * @param message - 计时器描述消息
     * @param extra - 额外的结构化数据
     * @returns 计时器对象，支持 stop() 和 Symbol.dispose
     */
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      /** 停止计时并记录完成日志 */
      stop(): void

      /** Symbol.dispose 实现，支持 using 声明 */
      [Symbol.dispose](): void
    }
  }

  /**
   * Logger 缓存
   *
   * 按 service 名称缓存 Logger 实例。
   * 确保相同 service 的 Logger 单例。
   */
  const loggers = new Map<string, Logger>()

  /**
   * 默认 Logger 实例
   *
   * 用于没有指定 service 的通用日志。
   */
  export const Default = create({ service: "default" })

  /**
   * 日志选项接口
   *
   * 定义日志系统初始化时的配置选项。
   */
  export interface Options {
    /** 是否输出到控制台（默认为 true） */
    print: boolean

    /** 是否为开发模式（影响日志文件名） */
    dev?: boolean

    /** 设置日志级别 */
    level?: Level
  }

  /**
   * 当前日志文件路径
   *
   * 初始化时设置，file() 函数返回此值。
   */
  let logpath = ""

  /**
   * 获取当前日志文件路径
   * @returns 日志文件的完整路径
   */
  export function file() {
    return logpath
  }

  /**
   * 日志写入函数
   *
   * 默认写入到 stderr。
   * 初始化后可能被替换为文件写入。
   */
  let write = (msg: any) => {
    process.stderr.write(msg)
    return msg.length
  }

  /**
   * 初始化日志系统
   *
   * 配置日志输出方式、级别和文件。
   *
   * 执行步骤：
   * 1. 设置日志级别（如果指定）
   * 2. 清理旧日志文件
   * 3. 如果 print=true，直接返回（使用控制台输出）
   * 4. 否则，创建日志文件并设置文件写入器
   *
   * @param options - 日志配置选项
   */
  export async function init(options: Options) {
    // 设置日志级别（如果指定）
    if (options.level) level = options.level

    // 清理日志目录中的旧文件
    cleanup(Global.Path.log)

    // 如果是打印模式，不创建日志文件
    if (options.print) return

    // 构建日志文件路径
    // 开发模式：dev.log
    // 生产模式：YYYY-MM-DDTHHMMSS.log（ISO 时间戳）
    logpath = path.join(
      Global.Path.log,
      options.dev
        ? "dev.log"
        : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
    )

    // 创建日志文件
    const logfile = Bun.file(logpath)

    // 清空现有日志文件（如果存在）
    await fs.truncate(logpath).catch(() => {})

    // 创建文件写入器
    const writer = logfile.writer()

    // 替换写入函数为文件写入
    write = async (msg: any) => {
      const num = writer.write(msg)
      writer.flush()
      return num
    }
  }

  /**
   * 清理旧日志文件
   *
   * 保留最新的 10 个日志文件，删除其余的。
   * 匹配格式：YYYY-MM-DDTHHMMSS.log
   *
   * @param dir - 日志目录路径
   */
  async function cleanup(dir: string) {
    // 匹配 ISO 时间格式的日志文件
    const glob = new Bun.Glob("????-??-??T??????.log")

    // 扫描目录中的所有匹配文件
    const files = await Array.fromAsync(
      glob.scan({
        cwd: dir,
        absolute: true,
      }),
    )

    // 如果文件数 <= 5，不需要清理
    if (files.length <= 5) return

    // 删除除了最新 10 个文件之外的所有文件
    const filesToDelete = files.slice(0, -10)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  /**
   * 格式化 Error 对象
   *
   * 递归处理 Error 的 cause 链，生成完整的错误信息。
   * 最大深度为 10，防止无限递归。
   *
   * @param error - 错误对象
   * @param depth - 当前递归深度
   * @returns 格式化的错误消息
   */
  function formatError(error: Error, depth = 0): string {
    const result = error.message
    // 如果有 cause 且是 Error 类型，递归格式化
    return error.cause instanceof Error && depth < 10
      ? result + " Caused by: " + formatError(error.cause, depth + 1)
      : result
  }

  /**
   * 上一次日志的时间戳
   *
   * 用于计算日志之间的时间差。
   */
  let last = Date.now()

  /**
   * 创建新的 Logger 实例
   *
   * 支持按 service 名称缓存，确保相同 service 的 Logger 单例。
   *
   * @param tags - 日志标签对象（必须包含 service 用于缓存）
   * @returns Logger 实例
   */
  export function create(tags?: Record<string, any>) {
    // 默认为空标签对象
    tags = tags || {}

    // 提取 service 标签
    const service = tags["service"]

    // 如果有 service 且已缓存，返回缓存的 Logger
    if (service && typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    /**
     * 构建日志消息
     *
     * 格式：[时间戳] [+耗时ms] [标签1=值1 标签2=值2] 消息
     *
     * @param message - 日志消息
     * @param extra - 额外的标签
     * @returns 格式化后的日志字符串
     */
    function build(message: any, extra?: Record<string, any>) {
      // 格式化标签
      const prefix = Object.entries({
        ...tags,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)  // 过滤空值
        .map(([key, value]) => {
          const prefix = `${key}=`
          // 特殊处理 Error 对象
          if (value instanceof Error) return prefix + formatError(value)
          // 特殊处理对象（JSON 序列化）
          if (typeof value === "object") return prefix + JSON.stringify(value)
          // 普通值直接拼接
          return prefix + value
        })
        .join(" ")

      // 计算与上一条日志的时间差
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()

      // 组合完整日志：时间戳 + 时间差 + 标签 + 消息
      return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message]
        .filter(Boolean)  // 过滤空部分
        .join(" ") + "\n"
    }

    /**
     * Logger 实现对象
     */
    const result: Logger = {
      /**
       * DEBUG 级别日志
       */
      debug(message?: any, extra?: Record<string, any>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
        }
      },

      /**
       * INFO 级别日志
       */
      info(message?: any, extra?: Record<string, any>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
        }
      },

      /**
       * ERROR 级别日志
       */
      error(message?: any, extra?: Record<string, any>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
        }
      },

      /**
       * WARN 级别日志
       */
      warn(message?: any, extra?: Record<string, any>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
        }
      },

      /**
       * 添加标签
       */
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },

      /**
       * 克隆 Logger
       * 创建一个具有相同标签的新实例
       */
      clone() {
        return Log.create({ ...tags })
      },

      /**
       * 创建计时器
       *
       * 立即输出 started 日志，stop() 时输出 completed 日志。
       * 支持 using 声明自动调用 stop()。
       */
      time(message: string, extra?: Record<string, any>) {
        // 记录开始时间
        const now = Date.now()

        // 输出 started 日志
        result.info(message, { status: "started", ...extra })

        /**
         * 停止计时并输出完成日志
         */
        function stop() {
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,  // 计算持续时间（毫秒）
            ...extra,
          })
        }

        // 返回计时器对象
        return {
          stop,
          // 实现 Symbol.dispose，支持 using 声明
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    // 如果有 service，缓存 Logger
    if (service && typeof service === "string") {
      loggers.set(service, result)
    }

    return result
  }
}
