/**
 * ============================================================================
 * 文件名：acp.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * ACP (Agent Client Protocol) 服务器命令。启动 ACP 服务器以支持与 Agent 的通信。
 *
 * 主要功能：
 * - AcpCommand：启动 ACP 服务器的命令
 * - 创建本地 HTTP 服务器
 * - 建立 stdin/stdout 与 ACP 的双向通信
 * - 集成 OpenCode SDK
 *
 * 依赖关系：
 * - @/util/log：日志记录
 * - ../bootstrap：实例引导
 * - ./cmd：命令包装
 * - @agentclientprotocol/sdk：ACP SDK
 * - @/acp/agent：ACP 代理集成
 * - @/server/server：HTTP 服务器
 * - @opencode-ai/sdk/v2：OpenCode SDK
 * - ../network：网络选项
 *
 * 导出内容：
 * - AcpCommand：ACP 服务器命令定义
 *
 * 命令选项：
 * - cwd：工作目录（默认：当前目录）
 * - port、hostname、mdns、cors：继承自网络选项
 *
 * 工作流程：
 * 1. 引导实例并启动 HTTP 服务器
 * 2. 创建 OpenCode SDK 客户端
 * 3. 将 stdout 包装为 WritableStream
 * 4. 将 stdin 包装为 ReadableStream
 * 5. 创建 NDJSON 流
 * 6. 初始化 ACP 代理
 * 7. 创建 AgentSideConnection
 * 8. 等待 stdin 结束
 *
 * 协议：
 * - NDJSON (Newline-Delimited JSON) 用于消息传递
 *
 * @package opencode
 * @module cli/cmd/acp
 */

// 导入日志工具
import { Log } from "@/util/log"

// 导入实例引导
import { bootstrap } from "../bootstrap"

// 导入命令包装
import { cmd } from "./cmd"

// 导入 ACP SDK
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"

// 导入 ACP 代理集成
import { ACP } from "@/acp/agent"

// 导入 HTTP 服务器
import { Server } from "@/server/server"

// 导入 OpenCode SDK
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

// 导入网络选项
import { withNetworkOptions, resolveNetworkOptions } from "../network"

// 创建日志记录器
const log = Log.create({ service: "acp-command" })

/**
 * ACP 服务器命令
 *
 * 启动 ACP (Agent Client Protocol) 服务器，支持与外部 Agent 的双向通信。
 */
export const AcpCommand = cmd({
  // 命令名称
  command: "acp",
  // 命令描述
  describe: "start ACP (Agent Client Protocol) server",
  // 构建命令选项
  builder: (yargs) => {
    // 添加网络选项
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      // 默认为当前工作目录
      default: process.cwd(),
    })
  },
  // 命令处理函数
  handler: async (args) => {
    // 引导实例并执行命令
    await bootstrap(process.cwd(), async () => {
      // 解析网络选项（合并 CLI 参数和配置文件）
      const opts = await resolveNetworkOptions(args)
      // 启动 HTTP 服务器监听
      const server = Server.listen(opts)

      // 创建 OpenCode SDK 客户端
      // 使用本地服务器地址作为 base URL
      const sdk = createOpencodeClient({
        baseUrl: `http://${server.hostname}:${server.port}`,
      })

      // 创建输出流：将 stdout 包装为 WritableStream
      // 用于向 Agent 发送消息
      const input = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise<void>((resolve, reject) => {
            // 写入数据块到 stdout
            process.stdout.write(chunk, (err) => {
              if (err) {
                // 写入失败，拒绝 Promise
                reject(err)
              } else {
                // 写入成功，解析 Promise
                resolve()
              }
            })
          })
        },
      })

      // 创建输入流：将 stdin 包装为 ReadableStream
      // 用于从 Agent 接收消息
      const output = new ReadableStream<Uint8Array>({
        start(controller) {
          // 监听 stdin 的 data 事件，接收数据
          process.stdin.on("data", (chunk: Buffer) => {
            // 将 Buffer 转换为 Uint8Array 并加入队列
            controller.enqueue(new Uint8Array(chunk))
          })
          // 监听 stdin 的 end 事件，关闭流
          process.stdin.on("end", () => controller.close())
          // 监听 stdin 的 error 事件，传递错误
          process.stdin.on("error", (err) => controller.error(err))
        },
      })

      // 创建 NDJSON (Newline-Delimited JSON) 流
      // 用于在 stdin/stdout 上传递 JSON 消息
      const stream = ndJsonStream(input, output)

      // 初始化 ACP 代理，传入 SDK 客户端
      const agent = await ACP.init({ sdk })

      // 创建 AgentSideConnection
      // ACP 服务器侧的连接，用于与 Agent 客户端通信
      new AgentSideConnection((conn) => {
        // 当连接建立时，创建 ACP 代理实例
        return agent.create(conn, { sdk })
      }, stream)

      // 记录连接建立日志
      log.info("setup connection")

      // 恢复 stdin 读取（默认是暂停的）
      process.stdin.resume()

      // 等待 stdin 结束或出错
      await new Promise((resolve, reject) => {
        process.stdin.on("end", resolve)
        process.stdin.on("error", reject)
      })
    })
  },
})
