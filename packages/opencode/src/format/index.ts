/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/format
 * ============================================================================
 *
 * 文件作用：
 * 代码格式化模块。自动检测并运行适当的代码格式化工具。
 *
 * 主要功能：
 * - init()：初始化格式化器，订阅文件编辑事件
 * - status()：获取所有格式化器的状态
 * - getFormatter(ext)：根据文件扩展名获取可用的格式化器
 * - isEnabled(item)：检查格式化器是否已启用
 *
 * 依赖关系：
 * - @/bus：全局事件总线
 * - @/file：文件操作和事件
 * - @/util/log：日志
 * - path：路径处理
 * - zod：类型验证
 * - ./formatter：内置格式化器定义
 * - @/config/config：配置管理
 * - remeda：深度合并工具
 * - @/project/instance：实例状态管理
 *
 * 导出内容：
 * - Format namespace：格式化管理命名空间
 *   - Status：格式化器状态 Zod schema
 *   - init()：初始化格式化
 *   - status()：获取所有格式化器状态
 *
 * 格式化流程：
 * 1. 文件编辑事件触发
 * 2. 根据文件扩展名查找匹配的格式化器
 * 3. 检查格式化器是否已启用
 * 4. 运行格式化命令
 *
 * 配置：
 * - cfg.formatter = false：禁用所有格式化器
 * - cfg.formatter[name].disabled：禁用特定格式化器
 * - cfg.formatter[name]：自定义格式化器配置
 *
 * @package opencode
 * @module format
 */

// 导入全局事件总线
import { Bus } from "../bus"

// 导入文件模块
import { File } from "../file"

// 导入日志
import { Log } from "../util/log"

// 导入路径处理
import path from "path"

// 导入 Zod 类型验证库
import z from "zod"

// 导入内置格式化器定义
import * as Formatter from "./formatter"

// 导入配置管理
import { Config } from "../config/config"

// 导入深度合并工具
import { mergeDeep } from "remeda"

// 导入实例状态管理
import { Instance } from "../project/instance"

/**
 * 格式化管理命名空间
 *
 * 包含所有代码格式化相关的功能。
 */
export namespace Format {
  // 创建格式化服务日志记录器
  const log = Log.create({ service: "format" })

  /**
   * 格式化器状态 Zod Schema
   *
   * 描述格式化器的状态信息。
   */
  export const Status = z
    .object({
      // 格式化器名称
      name: z.string(),
      // 支持的文件扩展名列表
      extensions: z.string().array(),
      // 是否已启用
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  /**
   * 格式化器状态
   *
   * 使用 Instance.state() 创建响应式状态。
   * 存储所有格式化器的配置和启用状态。
   */
  const state = Instance.state(async () => {
    // 格式化器启用状态缓存
    const enabled: Record<string, boolean> = {}

    // 获取配置
    const cfg = await Config.get()

    // 格式化器映射
    const formatters: Record<string, Formatter.Info> = {}

    // 如果格式化功能被禁用，返回空状态
    if (cfg.formatter === false) {
      log.info("all formatters are disabled")
      return {
        enabled,
        formatters,
      }
    }

    // 添加所有内置格式化器
    for (const item of Object.values(Formatter)) {
      formatters[item.name] = item
    }

    // 处理用户自定义的格式化器配置
    for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
      // 如果格式化器被禁用，移除它
      if (item.disabled) {
        delete formatters[name]
        continue
      }

      // 合并用户配置和默认配置
      const result: Formatter.Info = mergeDeep(formatters[name] ?? {}, {
        command: [],
        extensions: [],
        ...item,
      })

      // 如果没有配置命令，跳过
      if (result.command.length === 0) continue

      // 覆盖启用检查函数（默认始终启用）
      result.enabled = async () => true

      // 设置格式化器名称
      result.name = name

      // 添加到格式化器映射
      formatters[name] = result
    }

    return {
      enabled,
      formatters,
    }
  })

  /**
   * 检查格式化器是否已启用
   *
   * 使用缓存避免重复检查。
   *
   * @param item - 格式化器信息
   * @returns Promise，是否已启用
   */
  async function isEnabled(item: Formatter.Info) {
    const s = await state()

    // 从缓存中获取状态
    let status = s.enabled[item.name]

    // 如果缓存中没有，执行启用检查
    if (status === undefined) {
      status = await item.enabled()
      s.enabled[item.name] = status
    }

    return status
  }

  /**
   * 获取适用于指定文件扩展名的格式化器
   *
   * @param ext - 文件扩展名（如 ".ts"）
   * @returns Promise，解析为格式式化器列表
   */
  async function getFormatter(ext: string) {
    const formatters = await state().then((x) => x.formatters)
    const result = []

    // 遍历所有格式化器
    for (const item of Object.values(formatters)) {
      log.info("checking", { name: item.name, ext })

      // 检查是否支持此扩展名
      if (!item.extensions.includes(ext)) continue

      // 检查是否已启用
      if (!(await isEnabled(item))) continue

      log.info("enabled", { name: item.name, ext })
      result.push(item)
    }

    return result
  }

  /**
   * 获取所有格式化器的状态
   *
   * @returns Promise，解析为格式化器状态列表
   */
  export async function status() {
    const s = await state()
    const result: Status[] = []

    // 遍历所有格式化器
    for (const formatter of Object.values(s.formatters)) {
      const enabled = await isEnabled(formatter)
      result.push({
        name: formatter.name,
        extensions: formatter.extensions,
        enabled,
      })
    }

    return result
  }

  /**
   * 初始化格式化功能
   *
   * 订阅文件编辑事件，在文件保存后自动格式化。
   */
  export function init() {
    log.info("init")

    // 订阅文件编辑事件
    Bus.subscribe(File.Event.Edited, async (payload) => {
      // 获取编辑的文件路径
      const file = payload.properties.file
      log.info("formatting", { file })

      // 获取文件扩展名
      const ext = path.extname(file)

      // 获取适用的格式化器
      for (const item of await getFormatter(ext)) {
        log.info("running", { command: item.command })
        try {
          // 启动格式化进程
          const proc = Bun.spawn({
            // 替换 $FILE 占位符为实际文件路径
            cmd: item.command.map((x) => x.replace("$FILE", file)),
            cwd: Instance.directory,
            // 合并环境变量
            env: { ...process.env, ...item.environment },
            stdout: "ignore",  // 忽略标准输出
            stderr: "ignore",  // 忽略标准错误
          })

          // 等待进程退出
          const exit = await proc.exited

          // 如果格式化失败，记录错误
          if (exit !== 0)
            log.error("failed", {
              command: item.command,
              ...item.environment,
            })
        } catch (error) {
          // 捕获并记录格式化错误
          log.error("failed to format file", {
            error,
            command: item.command,
            ...item.environment,
            file,
          })
        }
      }
    })
  }
}
