/**
 * ============================================================================
 * 文件名：session.ts
 * 所属包：packages/opencode/src/acp
 * ============================================================================
 *
 * 文件作用：
 * ACP 会话管理器。管理 ACP 会话的创建、加载和状态维护。
 *
 * 主要功能：
 * - ACPSessionManager：ACP 会话管理器类
 * - create()：创建新会话
 * - load()：加载现有会话
 * - get()：获取会话状态
 * - getModel()：获取会话模型
 * - setModel()：设置会话模型
 * - setMode()：设置会话模式
 *
 * 依赖关系：
 * - @agentclientprotocol/sdk：ACP SDK（RequestError, McpServer）
 * - ./types：ACP 类型定义
 * - ../util/log：日志记录
 * - @opencode-ai/sdk/v2：OpenCode SDK 客户端
 *
 * 导出内容：
 * - ACPSessionManager：会话管理器类
 *
 * @package opencode
 * @module acp/session
 */

// 导入 ACP SDK 类型
import { RequestError, type McpServer } from "@agentclientprotocol/sdk"

// 导入 ACP 类型定义
import type { ACPSessionState } from "./types"

// 导入日志工具
import { Log } from "@/util/log"

// 导入 OpenCode SDK 客户端类型
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

// 创建日志记录器
const log = Log.create({ service: "acp-session-manager" })

/**
 * ACP 会话管理器
 *
 * 管理所有 ACP 会话的状态和生命周期。
 */
export class ACPSessionManager {
  // 会话存储，使用 Map 结构存储所有活跃会话
  private sessions = new Map<string, ACPSessionState>()

  // OpenCode SDK 客户端实例
  private sdk: OpencodeClient

  /**
   * 构造函数
   *
   * @param sdk - OpenCode SDK 客户端实例
   */
  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  /**
   * 创建新会话
   *
   * 通过 OpenCode SDK 创建新会话，并初始化会话状态。
   *
   * @param cwd - 工作目录
   * @param mcpServers - MCP 服务器列表
   * @param model - 可选的模型配置
   * @returns Promise，解析为创建的会话状态
   */
  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    // 通过 SDK 创建会话
    const session = await this.sdk.session
      .create(
        {
          title: `ACP Session ${crypto.randomUUID()}`,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    // 获取会话 ID
    const sessionId = session.id

    // 使用提供的模型或 undefined
    const resolvedModel = model

    // 构造会话状态
    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }

    // 记录日志
    log.info("creating_session", { state })

    // 存储会话状态
    this.sessions.set(sessionId, state)
    return state
  }

  /**
   * 加载现有会话
   *
   * 通过 OpenCode SDK 加载现有会话，并初始化会话状态。
   *
   * @param sessionId - 会话 ID
   * @param cwd - 工作目录
   * @param mcpServers - MCP 服务器列表
   * @param model - 可选的模型配置
   * @returns Promise，解析为加载的会话状态
   */
  async load(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    // 通过 SDK 获取会话
    const session = await this.sdk.session
      .get(
        {
          sessionID: sessionId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    // 使用提供的模型或 undefined
    const resolvedModel = model

    // 构造会话状态（使用原始创建时间）
    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(session.time.created),
      model: resolvedModel,
    }

    // 记录日志
    log.info("loading_session", { state })

    // 存储会话状态
    this.sessions.set(sessionId, state)
    return state
  }

  /**
   * 获取会话状态
   *
   * @param sessionId - 会话 ID
   * @returns 会话状态
   * @throws 如果会话不存在则抛出错误
   */
  get(sessionId: string): ACPSessionState {
    // 从存储中获取会话
    const session = this.sessions.get(sessionId)

    // 如果不存在，记录错误并抛出异常
    if (!session) {
      log.error("session not found", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }

    return session
  }

  /**
   * 获取会话模型
   *
   * @param sessionId - 会话 ID
   * @returns 模型配置（可能为 undefined）
   */
  getModel(sessionId: string) {
    const session = this.get(sessionId)
    return session.model
  }

  /**
   * 设置会话模型
   *
   * @param sessionId - 会话 ID
   * @param model - 模型配置
   * @returns 更新后的会话状态
   */
  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId)
    session.model = model
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * 设置会话模式
   *
   * @param sessionId - 会话 ID
   * @param modeId - 模式 ID（Agent 名称）
   * @returns 更新后的会话状态
   */
  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    return session
  }
}
