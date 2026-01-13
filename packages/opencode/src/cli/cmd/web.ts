/**
 * ============================================================================
 * 文件名：web.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * Web 命令模块。启动 OpenCode 服务器并打开 Web 界面。
 *
 * 主要功能：
 * - WebCommand：Web 命令
 * - 启动服务器并在浏览器中打开
 * - 显示本地和网络访问地址
 * - 检测网络 IP 地址（排除 Docker 网桥）
 * - 支持 mDNS 服务发现
 *
 * 依赖关系：
 * - ../../server/server：服务器模块
 * - ../ui：UI 工具
 * - ./cmd：命令包装
 * - ../network：网络选项
 * - ../../flag/flag：标志位
 * - open：在浏览器中打开 URL
 * - os：网络接口
 *
 * 导出内容：
 * - WebCommand：Web 命令定义
 * - getNetworkIPs()：获取网络 IP 地址
 *
 * 网络选项：
 * - port：监听端口（默认：0，自动分配）
 * - hostname：监听主机名（默认：127.0.0.1）
 * - mdns：启用 mDNS 服务发现（默认：false）
 *
 * IP 过滤规则：
 * - 排除内部地址（loopback）
 * - 排除非 IPv4 地址
 * - 排除 Docker 网桥（172.x.x.x）
 *
 * 安全：
 * - 如果未设置 OPENCODE_SERVER_PASSWORD，显示警告
 *
 * @package opencode
 * @module cli/cmd/web
 */

// 导入服务器模块
import { Server } from "../../server/server"

// 导入 UI 工具
import { UI } from "../ui"

// 导入命令包装
import { cmd } from "./cmd"

// 导入网络选项
import { withNetworkOptions, resolveNetworkOptions } from "../network"

// 导入标志位
import { Flag } from "../../flag/flag"

// 导入 open（在浏览器中打开 URL）
import open from "open"

// 导入网络接口
import { networkInterfaces } from "os"

/**
 * 获取网络 IP 地址
 *
 * 获取所有可用于远程访问的网络 IP 地址。
 *
 * @returns IP 地址数组
 *
 * 过滤规则：
 * - 排除内部地址（loopback）
 * - 排除非 IPv4 地址
 * - 排除 Docker 网桥网络（172.x.x.x）
 */
function getNetworkIPs() {
  // 获取所有网络接口
  const nets = networkInterfaces()
  const results: string[] = []

  // 遍历每个网络接口
  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    // 遍历接口的每个地址
    for (const netInfo of net) {
      // 跳过内部地址和非 IPv4 地址
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // 跳过 Docker 网桥网络（通常是 172.x.x.x）
      if (netInfo.address.startsWith("172.")) continue

      // 添加到结果
      results.push(netInfo.address)
    }
  }

  return results
}

/**
 * Web 命令
 *
 * 启动 OpenCode 服务器并打开 Web 界面。
 */
export const WebCommand = cmd({
  command: "web",
  // 添加网络选项
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    // 检查是否设置了服务器密码
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    // 解析网络选项（合并 CLI 参数和配置文件）
    const opts = await resolveNetworkOptions(args)
    // 启动服务器监听
    const server = Server.listen(opts)
    // 打印空行
    UI.empty()
    // 打印 Logo
    UI.println(UI.logo("  "))
    // 打印空行
    UI.empty()

    // 监听所有网络接口（0.0.0.0）
    if (opts.hostname === "0.0.0.0") {
      // 显示本地访问地址
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // 显示网络访问地址（远程访问）
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      // 显示 mDNS 地址（如果启用）
      if (opts.mdns) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "  mDNS:              ", UI.Style.TEXT_NORMAL, "opencode.local")
      }

      // 在浏览器中打开本地地址
      open(localhostUrl.toString()).catch(() => {})
    }
    // 监听特定地址
    else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      // 在浏览器中打开
      open(displayUrl).catch(() => {})
    }

    // 永久等待（直到手动停止）
    await new Promise(() => {})
    // 清理：停止服务器
    await server.stop()
  },
})
