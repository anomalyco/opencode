/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/pty
 * ============================================================================
 *
 * 文件作用：
 * PTY（伪终端）管理模块。提供终端会话的创建、管理和 WebSocket 连接功能。
 *
 * 主要功能：
 * - 创建 PTY 会话（终端会话）
 * - 管理活动会话状态
 * - WebSocket 连接管理（多客户端订阅）
 * - 终端输出缓冲（大小限制）
 * - 终端尺寸调整
 * - 写入数据到终端
 *
 * 依赖关系：
 * - @/bus/bus-event：事件定义
 * - @/bus：全局事件总线
 * - bun-pty：PTY 实现
 * - zod：类型验证
 * - ../id/id：标识符生成
 * - ../util/log：日志
 * - hono/ws：WebSocket 上下文
 * - ../project/instance：实例状态管理
 * - @opencode-ai/util/lazy：延迟加载
 * - @/shell/shell：Shell 工具
 *
 * 导出内容：
 * - Pty namespace：PTY 管理命名空间
 *   - Info：PTY 信息 Zod schema
 *   - CreateInput：创建输入 Zod schema
 *   - UpdateInput：更新输入 Zod schema
 *   - Event：PTY 事件
 *   - list()：列出所有 PTY 会话
 *   - get(id)：获取指定 PTY 会话
 *   - create(input)：创建新 PTY 会话
 *   - update(id, input)：更新 PTY 会话
 *   - remove(id)：删除 PTY 会话
 *   - resize(id, cols, rows)：调整终端尺寸
 *   - write(id, data)：写入数据到终端
 *   - connect(id, ws)：连接 WebSocket 到 PTY
 *
 * 常量：
 * - BUFFER_LIMIT：缓冲区大小限制（2MB）
 * - BUFFER_CHUNK：缓冲区分块大小（64KB）
 *
 * PTY 状态：
 * - running：运行中
 * - exited：已退出
 *
 * @package opencode
 * @module pty
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入全局事件总线
import { Bus } from "@/bus"

// 导入 PTY 类型
import { type IPty } from "bun-pty"

// 导入 Zod 类型验证库
import z from "zod"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入日志
import { Log } from "../util/log"

// 导入 WebSocket 上下文类型
import type { WSContext } from "hono/ws"

// 导入实例状态管理
import { Instance } from "../project/instance"

// 导入延迟加载工具
import { lazy } from "@opencode-ai/util/lazy"

// 导入 Shell 工具
import { Shell } from "@/shell/shell"

/**
 * PTY 管理命名空间
 *
 * 包含所有 PTY（伪终端）相关的功能。
 */
export namespace Pty {
  // 创建 PTY 服务日志记录器
  const log = Log.create({ service: "pty" })

  /**
   * 缓冲区大小限制
   *
   * 单个 PTY 会话的最大输出缓冲量（2MB）。
   * 超过后会丢弃最早的输出。
   */
  const BUFFER_LIMIT = 1024 * 1024 * 2

  /**
   * 缓冲区分块大小
   *
   * 发送缓冲数据到 WebSocket 时的分块大小（64KB）。
   * 避免发送过大的消息导致性能问题。
   */
  const BUFFER_CHUNK = 64 * 1024

  /**
   * PTY spawn 函数（延迟加载）
   *
   * bun-pty 模块较大，使用延迟加载优化启动时间。
   */
  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

  /**
   * PTY 信息 Zod Schema
   *
   * 描述 PTY 会话的信息结构。
   */
  export const Info = z
    .object({
      // PTY ID（以 "pty_" 开头）
      id: Identifier.schema("pty"),
      // 会话标题
      title: z.string(),
      // 执行的命令
      command: z.string(),
      // 命令参数
      args: z.array(z.string()),
      // 工作目录
      cwd: z.string(),
      // 会话状态
      status: z.enum(["running", "exited"]),
      // 进程 ID
      pid: z.number(),
    })
    .meta({ ref: "Pty" })
  export type Info = z.infer<typeof Info>

  /**
   * 创建 PTY 输入 Zod Schema
   *
   * 验证创建 PTY 会话的输入参数。
   */
  export const CreateInput = z.object({
    // 要执行的命令（可选，默认为系统默认 shell）
    command: z.string().optional(),
    // 命令参数（可选）
    args: z.array(z.string()).optional(),
    // 工作目录（可选）
    cwd: z.string().optional(),
    // 会话标题（可选）
    title: z.string().optional(),
    // 环境变量（可选）
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * 更新 PTY 输入 Zod Schema
   *
   * 验证更新 PTY 会话的输入参数。
   */
  export const UpdateInput = z.object({
    // 新标题（可选）
    title: z.string().optional(),
    // 新尺寸（可选）
    size: z
      .object({
        // 行数
        rows: z.number(),
        // 列数
        cols: z.number(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  /**
   * PTY 事件
   *
   * 定义 PTY 相关的事件类型。
   */
  export const Event = {
    /**
     * PTY 创建事件
     *
     * 当新的 PTY 会话创建时触发。
     */
    Created: BusEvent.define("pty.created", z.object({ info: Info })),

    /**
     * PTY 更新事件
     *
     * 当 PTY 会话更新时触发。
     */
    Updated: BusEvent.define("pty.updated", z.object({ info: Info })),

    /**
     * PTY 退出事件
     *
     * 当 PTY 会话退出时触发。
     */
    Exited: BusEvent.define("pty.exited", z.object({ id: Identifier.schema("pty"), exitCode: z.number() })),

    /**
     * PTY 删除事件
     *
     * 当 PTY 会话被删除时触发。
     */
    Deleted: BusEvent.define("pty.deleted", z.object({ id: Identifier.schema("pty") })),
  }

  /**
   * 活动会话接口
   *
   * 描述一个活动的 PTY 会话。
   */
  interface ActiveSession {
    // 会话信息
    info: Info
    // PTY 进程对象
    process: IPty
    // 输出缓冲区（当没有订阅者时使用）
    buffer: string
    // WebSocket 订阅者集合
    subscribers: Set<WSContext>
  }

  /**
   * 会话状态
   *
   * 使用 Instance.state() 创建响应式状态。
   * 存储所有活动的 PTY 会话。
   *
   * 清理函数：
   * - 杀死所有 PTY 进程
   * - 关闭所有 WebSocket 连接
   * - 清空会话映射
   */
  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      // 清理所有会话
      for (const session of sessions.values()) {
        try {
          session.process.kill()
        } catch {}
        for (const ws of session.subscribers) {
          ws.close()
        }
      }
      sessions.clear()
    },
  )

  /**
   * 列出所有 PTY 会话
   *
   * @returns 所有 PTY 会话的信息数组
   */
  export function list() {
    return Array.from(state().values()).map((s) => s.info)
  }

  /**
   * 获取指定 PTY 会话
   *
   * @param id - PTY ID
   * @returns PTY 会话信息，如果不存在返回 undefined
   */
  export function get(id: string) {
    return state().get(id)?.info
  }

  /**
   * 创建新的 PTY 会话
   *
   * 生成新的 PTY ID，启动终端进程，并设置输出处理。
   *
   * @param input - 创建参数
   * @returns Promise，解析为 PTY 会话信息
   *
   * 行为：
   * - 如果命令是 sh，自动添加 -l 参数（登录 shell）
   * - 设置 TERM=xterm-256color 环境变量
   * - 输出会被发送到所有 WebSocket 订阅者
   * - 如果没有订阅者，输出会被缓冲
   * - 缓冲区大小有限制（BUFFER_LIMIT）
   */
  export async function create(input: CreateInput) {
    // 生成新的 PTY ID
    const id = Identifier.create("pty", false)
    // 确定要执行的命令（默认为系统默认 shell）
    const command = input.command || Shell.preferred()
    const args = input.args || []
    // 如果是 sh，添加 -l 参数（登录 shell）
    if (command.endsWith("sh")) {
      args.push("-l")
    }

    // 确定工作目录（默认为实例目录）
    const cwd = input.cwd || Instance.directory
    // 合并环境变量，设置 TERM
    const env = { ...process.env, ...input.env, TERM: "xterm-256color" } as Record<string, string>
    log.info("creating session", { id, cmd: command, args, cwd })

    // 获取 spawn 函数并创建 PTY 进程
    const spawn = await pty()
    const ptyProcess = spawn(command, args, {
      name: "xterm-256color",
      cwd,
      env,
    })

    // 构建会话信息
    const info = {
      id,
      title: input.title || `Terminal ${id.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: ptyProcess.pid,
    } as const

    // 创建活动会话对象
    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      subscribers: new Set(),
    }
    state().set(id, session)

    // 处理 PTY 输出数据
    ptyProcess.onData((data) => {
      let open = false
      // 发送数据到所有订阅者
      for (const ws of session.subscribers) {
        // 移除已关闭的连接
        if (ws.readyState !== 1) {
          session.subscribers.delete(ws)
          continue
        }
        open = true
        ws.send(data)
      }
      // 如果有活跃订阅者，不缓冲
      if (open) return
      // 缓冲输出数据
      session.buffer += data
      // 限制缓冲区大小
      if (session.buffer.length <= BUFFER_LIMIT) return
      session.buffer = session.buffer.slice(-BUFFER_LIMIT)
    })

    // 处理 PTY 退出
    ptyProcess.onExit(({ exitCode }) => {
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      Bus.publish(Event.Exited, { id, exitCode })
      state().delete(id)
    })

    // 发布创建事件
    Bus.publish(Event.Created, { info })
    return info
  }

  /**
   * 更新 PTY 会话
   *
   * 更新会话标题或调整终端尺寸。
   *
   * @param id - PTY ID
   * @param input - 更新参数
   * @returns Promise，解析为更新后的会话信息，如果会话不存在返回 undefined
   */
  export async function update(id: string, input: UpdateInput) {
    const session = state().get(id)
    if (!session) return
    // 更新标题
    if (input.title) {
      session.info.title = input.title
    }
    // 调整终端尺寸
    if (input.size) {
      session.process.resize(input.size.cols, input.size.rows)
    }
    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  /**
   * 删除 PTY 会话
   *
   * 终止 PTY 进程，关闭所有 WebSocket 连接，清理会话状态。
   *
   * @param id - PTY ID
   */
  export async function remove(id: string) {
    const session = state().get(id)
    if (!session) return
    log.info("removing session", { id })
    try {
      session.process.kill()
    } catch {}
    // 关闭所有 WebSocket 连接
    for (const ws of session.subscribers) {
      ws.close()
    }
    state().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  /**
   * 调整终端尺寸
   *
   * 调整运行中 PTY 会话的终端尺寸。
   *
   * @param id - PTY ID
   * @param cols - 列数
   * @param rows - 行数
   */
  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
    }
  }

  /**
   * 写入数据到终端
   *
   * 将数据写入运行中 PTY 会话的标准输入。
   *
   * @param id - PTY ID
   * @param data - 要写入的数据
   */
  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
    }
  }

  /**
   * 连接 WebSocket 到 PTY 会话
   *
   * 将 WebSocket 连接到 PTY 会话，实时接收终端输出。
   *
   * @param id - PTY ID
   * @param ws - WebSocket 上下文
   * @returns 连接处理器对象，包含 onMessage 和 onClose 回调
   *
   * 行为：
   * - 如果会话不存在，关闭 WebSocket
   * - 发送缓冲的输出（分块发送）
   * - 后续输出实时发送到 WebSocket
   * - WebSocket 消息写入 PTY 输入
   * - WebSocket 关闭时移除订阅者
   */
  export function connect(id: string, ws: WSContext) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })
    // 添加订阅者
    session.subscribers.add(ws)
    // 发送缓冲的输出
    if (session.buffer) {
      const buffer = session.buffer.length <= BUFFER_LIMIT ? session.buffer : session.buffer.slice(-BUFFER_LIMIT)
      session.buffer = ""
      try {
        // 分块发送，避免单次发送过大
        for (let i = 0; i < buffer.length; i += BUFFER_CHUNK) {
          ws.send(buffer.slice(i, i + BUFFER_CHUNK))
        }
      } catch {
        // 发送失败，移除订阅者
        session.subscribers.delete(ws)
        session.buffer = buffer
        ws.close()
        return
      }
    }
    // 返回连接处理器
    return {
      // 处理来自 WebSocket 的消息（写入 PTY）
      onMessage: (message: string | ArrayBuffer) => {
        session.process.write(String(message))
      },
      // 处理 WebSocket 关闭
      onClose: () => {
        log.info("client disconnected from session", { id })
        session.subscribers.delete(ws)
      },
    }
  }
}
