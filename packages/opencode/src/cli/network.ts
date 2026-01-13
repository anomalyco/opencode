/**
 * ============================================================================
 * 文件名：network.ts
 * 所属包：packages/opencode/src/cli
 * ============================================================================
 *
 * 文件作用：
 * CLI 网络选项配置模块。提供服务器网络相关的命令行选项解析功能。
 *
 * 主要功能：
 * - NetworkOptions 类型：网络选项类型定义
 * - withNetworkOptions()：向 yargs 添加网络选项
 * - resolveNetworkOptions()：解析并合并网络选项（CLI 参数 + 配置文件）
 *
 * 依赖关系：
 * - yargs：命令行参数解析库
 * - ../config/config：配置管理
 *
 * 导出内容：
 * - NetworkOptions：网络选项类型
 * - withNetworkOptions()：添加网络选项到 yargs
 * - resolveNetworkOptions()：解析网络选项
 *
 * 网络选项：
 * - port：监听端口（默认：0，自动分配）
 * - hostname：监听主机名（默认：127.0.0.1）
 * - mdns：启用 mDNS 服务发现（默认：false）
 * - cors：额外的 CORS 允许域名（默认：[]）
 *
 * 解析优先级：
 * 1. CLI 显式设置的参数（通过 --port、--hostname 等）
 * 2. 配置文件中的值（opencode.json 的 server 字段）
 * 3. 默认值
 *
 * mDNS 特殊处理：
 * - 启用 mDNS 时，hostname 默认为 0.0.0.0（允许局域网访问）
 * - 如果配置中没有设置 hostname 且启用了 mDNS，使用 0.0.0.0
 *
 * CORS 合并：
 * - 配置文件的 CORS 和 CLI 参数的 CORS 会合并
 *
 * @package opencode
 * @module cli/network
 */

// 导入 yargs 类型
import type { Argv, InferredOptionTypes } from "yargs"

// 导入配置管理
import { Config } from "../config/config"

/**
 * 网络选项定义
 *
 * 定义所有网络相关的命令行选项。
 */
const options = {
  // 端口号选项
  port: {
    type: "number" as const,
    describe: "port to listen on",
    // 默认为 0，表示自动分配可用端口
    default: 0,
  },
  // 主机名选项
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    // 默认只监听本地
    default: "127.0.0.1",
  },
  // mDNS 服务发现选项
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    // 默认不启用 mDNS
    default: false,
  },
  // CORS 选项
  cors: {
    type: "string" as const,
    // 允许指定多个域名
    array: true,
    describe: "additional domains to allow for CORS",
    // 默认没有额外的 CORS 域名
    default: [] as string[],
  },
}

/**
 * 网络选项类型推断
 *
 * 从 options 定义中推断出的类型。
 */
export type NetworkOptions = InferredOptionTypes<typeof options>

/**
 * 向 yargs 添加网络选项
 *
 * 将网络选项注册到 yargs 解析器中。
 *
 * @template T - yargs 的其他选项类型
 * @param yargs - yargs 解析器实例
 * @returns 添加了网络选项的 yargs 解析器
 *
 * 使用示例：
 * ```typescript
 * export const serveCommand = {
 *   command: "serve",
 *   handler: async (argv) => {
 *     // argv 包含所有网络选项
 *   }
 * }
 *
 * // 在命令定义中使用
 * export default cmd(serveCommand).option(withNetworkOptions)
 * ```
 */
export function withNetworkOptions<T>(yargs: Argv<T>) {
  // 将网络选项添加到 yargs 解析器
  return yargs.options(options)
}

/**
 * 解析网络选项
 *
 * 合并 CLI 参数和配置文件中的网络选项。
 * CLI 显式设置的参数优先于配置文件。
 *
 * @param args - 从 yargs 解析出的参数
 * @returns 解析后的网络选项
 *
 * 解析逻辑：
 * 1. 检查 CLI 是否显式设置了各选项
 * 2. 如果显式设置，使用 CLI 值
 * 3. 否则，使用配置文件中的值（如果有）
 * 4. 否则，使用默认值
 *
 * 特殊处理：
 * - mDNS：启用时 hostname 默认为 0.0.0.0（除非配置或 CLI 指定了其他值）
 * - CORS：配置文件和 CLI 的 CORS 域名会合并
 */
export async function resolveNetworkOptions(args: NetworkOptions) {
  // 获取全局配置
  const config = await Config.global()

  // 检查各选项是否在 CLI 中显式设置
  // 通过检查 process.argv 来判断是否显式传递了参数
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const corsExplicitlySet = process.argv.includes("--cors")

  // 解析 mdns 选项
  // 如果 CLI 显式设置了 mdns，使用 CLI 值
  // 否则使用配置文件中的值，如果没有配置则使用 CLI 参数的默认值
  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)

  // 解析 port 选项
  // 如果 CLI 显式设置了 port，使用 CLI 值
  // 否则使用配置文件中的值，如果没有配置则使用默认值 0
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)

  // 解析 hostname 选项
  // 如果 CLI 显式设置了 hostname，使用 CLI 值
  // 否则如果启用了 mDNS 且配置中没有设置 hostname，使用 0.0.0.0
  // 否则使用配置文件中的值，如果没有配置则使用默认值 127.0.0.1
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)

  // 解析 CORS 选项
  // 获取配置文件中的 CORS 域名列表
  const configCors = config?.server?.cors ?? []
  // 确保 CLI 的 cors 是数组格式
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  // 合并配置文件和 CLI 的 CORS 域名
  const cors = [...configCors, ...argsCors]

  // 返回合并后的网络选项
  return { hostname, port, mdns, cors }
}
