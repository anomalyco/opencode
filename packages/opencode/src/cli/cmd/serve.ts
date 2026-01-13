/**
 * ============================================================================
 * 文件名：serve.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 服务器命令模块。启动无头 OpenCode 服务器。
 *
 * 主要功能：
 * - ServeCommand：启动服务器命令
 * - 合并网络选项（CLI 参数 + 配置文件）
 * - 监听指定端口和主机名
 *
 * 依赖关系：
 * - ../../server/server：服务器模块
 * - ./cmd：命令包装
 * - ../network：网络选项
 * - ../../flag/flag：标志位
 *
 * 导出内容：
 * - ServeCommand：服务器命令定义
 *
 * 网络选项：
 * - port：监听端口（默认：0，自动分配）
 * - hostname：监听主机名（默认：127.0.0.1）
 * - mdns：启用 mDNS 服务发现（默认：false）
 * - cors：额外的 CORS 允许域名（默认：[]）
 *
 * 安全：
 * - 如果未设置 OPENCODE_SERVER_PASSWORD，显示警告
 *
 * @package opencode
 * @module cli/cmd/serve
 */

// 导入服务器模块
import { Server } from "../../server/server"

// 导入命令包装
import { cmd } from "./cmd"

// 导入网络选项
import { withNetworkOptions, resolveNetworkOptions } from "../network"

// 导入标志位
import { Flag } from "../../flag/flag"

/**
 * 服务器命令
 *
 * 启动一个无头的 OpenCode 服务器，持续运行直到手动停止。
 */
export const ServeCommand = cmd({
  command: "serve",
  // 添加网络选项
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    // 检查是否设置了服务器密码
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    // 解析网络选项（合并 CLI 参数和配置文件）
    const opts = await resolveNetworkOptions(args)
    // 启动服务器监听
    const server = Server.listen(opts)
    // 显示监听地址
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    // 永久等待（直到手动停止）
    await new Promise(() => {})
    // 清理：停止服务器
    await server.stop()
  },
})
