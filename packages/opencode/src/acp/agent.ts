/**
 * ============================================================================
 * 文件名：agent.ts
 * 所属包：packages/opencode/src/acp
 * ============================================================================
 *
 * 文件作用：
 * ACP（Agent Client Protocol）Agent 实现。这是 OpenCode 对 ACP 协议的实现，
 * 充当 ACP 客户端和 OpenCode 后端之间的桥梁。
 *
 * 主要功能：
 * - init()：初始化 ACP Agent
 * - Agent 类：实现 ACPAgent 接口
 *   - initialize()：协议握手
 *   - newSession()：创建新会话
 *   - loadSession()：加载现有会话
 *   - prompt()：发送用户提示
 *   - cancel()：取消操作
 *   - setSessionModel()：设置会话模型
 *   - setSessionMode()：设置会话模式
 * - setupEventSubscriptions()：设置事件订阅
 * - processMessage()：处理消息回放
 * - loadSessionMode()：加载会话模式
 * - 辅助函数：toToolKind, toLocations, parseUri, getNewContent, defaultModel
 *
 * 依赖关系：
 * - @agentclientprotocol/sdk：ACP SDK 类型定义
 * - ../util/log：日志记录
 * - ./session：会话管理器
 * - ./types：ACP 类型定义
 * - ../provider/provider：提供商管理
 * - ../agent/agent：Agent 管理
 * - ../installation：版本信息
 * - ../session/message-v2：消息模型
 * - ../config/config：配置系统
 * - ../session/todo：待办事项
 * - zod：类型验证
 * - ai：AI SDK 错误类型
 * - @opencode-ai/sdk/v2：OpenCode SDK 客户端
 * - diff：差异应用
 *
 * 导出内容：
 * - ACP namespace：ACP Agent 命名空间
 *   - init()：初始化函数
 *   - Agent：ACP Agent 类
 *
 * 事件处理：
 * - permission.asked：权限请求
 * - message.part.updated：消息 part 更新
 *
 * @package opencode
 * @module acp/agent
 */

// 导入 ACP SDK 类型
import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthMethod,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PlanEntry,
  type PromptRequest,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type ToolCallContent,
  type ToolKind,
} from "@agentclientprotocol/sdk"

// 导入日志工具
import { Log } from "../util/log"

// 导入 ACP 会话管理器
import { ACPSessionManager } from "./session"

// 导入 ACP 类型定义
import type { ACPConfig, ACPSessionState } from "./types"

// 导入提供商管理
import { Provider } from "../provider/provider"

// 导入 Agent 管理
import { Agent as AgentModule } from "../agent/agent"

// 导入安装信息
import { Installation } from "@/installation"

// 导入消息模型
import { MessageV2 } from "@/session/message-v2"

// 导入配置系统
import { Config } from "@/config/config"

// 导入待办事项
import { Todo } from "@/session/todo"

// 导入 Zod
import { z } from "zod"

// 导入 AI SDK 错误类型
import { LoadAPIKeyError } from "ai"

// 导入 OpenCode SDK 类型
import type { OpencodeClient, SessionMessageResponse } from "@opencode-ai/sdk/v2"

// 导入差异应用工具
import { applyPatch } from "diff"

/**
 * ACP Agent 命名空间
 *
 * 提供 ACP Agent 的初始化和实现。
 */
export namespace ACP {
  // 创建日志记录器
  const log = Log.create({ service: "acp-agent" })

  /**
   * 初始化 ACP Agent
   *
   * 返回 Agent 工厂函数，用于创建 Agent 实例。
   *
   * @param _sdk - OpenCode SDK 客户端
   * @returns Agent 工厂对象
   */
  export async function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
    return {
      create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
        return new Agent(connection, fullConfig)
      },
    }
  }

  /**
   * ACP Agent 实现类
   *
   * 实现 ACPAgent 接口，作为 ACP 客户端和 OpenCode 后端之间的桥梁。
   */
  export class Agent implements ACPAgent {
    // ACP 连接对象
    private connection: AgentSideConnection

    // ACP 配置
    private config: ACPConfig

    // OpenCode SDK 客户端
    private sdk: OpencodeClient

    // 会话管理器
    private sessionManager

    /**
     * 构造函数
     *
     * @param connection - ACP 连接对象
     * @param config - ACP 配置
     */
    constructor(connection: AgentSideConnection, config: ACPConfig) {
      this.connection = connection
      this.config = config
      this.sdk = config.sdk
      this.sessionManager = new ACPSessionManager(this.sdk)
    }

    /**
     * 设置事件订阅
     *
     * 订阅 OpenCode 事件流，将事件转换为 ACP 协议消息。
     *
     * @param session - ACP 会话状态
     *
     * 处理的事件：
     * - permission.asked：工具权限请求
     * - message.part.updated：消息 part 更新
     */
    private setupEventSubscriptions(session: ACPSessionState) {
      const sessionId = session.id
      const directory = session.cwd

      // 定义权限选项
      const options: PermissionOption[] = [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ]

      // 订阅事件流
      this.config.sdk.event.subscribe({ directory }).then(async (events) => {
        for await (const event of events.stream) {
          switch (event.type) {
            // 处理权限请求事件
            case "permission.asked":
              try {
                const permission = event.properties

                // 向 ACP 客户端请求权限
                const res = await this.connection
                  .requestPermission({
                    sessionId,
                    toolCall: {
                      toolCallId: permission.tool?.callID ?? permission.id,
                      status: "pending",
                      title: permission.permission,
                      rawInput: permission.metadata,
                      kind: toToolKind(permission.permission),
                      locations: toLocations(permission.permission, permission.metadata),
                    },
                    options,
                  })
                  .catch(async (error) => {
                    // 请求失败，拒绝权限
                    log.error("failed to request permission from ACP", {
                      error,
                      permissionID: permission.id,
                      sessionID: permission.sessionID,
                    })
                    await this.config.sdk.permission.reply({
                      requestID: permission.id,
                      reply: "reject",
                      directory,
                    })
                    return
                  })

                // 没有响应
                if (!res) return

                // 用户取消
                if (res.outcome.outcome !== "selected") {
                  await this.config.sdk.permission.reply({
                    requestID: permission.id,
                    reply: "reject",
                    directory,
                  })
                  return
                }

                // 处理 edit 权限的预览
                if (res.outcome.optionId !== "reject" && permission.permission == "edit") {
                  const metadata = permission.metadata || {}
                  const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
                  const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""

                  // 读取原始文件内容
                  const content = await Bun.file(filepath).text()
                  // 应用差异获取新内容
                  const newContent = getNewContent(content, diff)

                  // 发送预览到客户端
                  if (newContent) {
                    this.connection.writeTextFile({
                      sessionId: sessionId,
                      path: filepath,
                      content: newContent,
                    })
                  }
                }

                // 回复权限结果
                await this.config.sdk.permission.reply({
                  requestID: permission.id,
                  reply: res.outcome.optionId as "once" | "always" | "reject",
                  directory,
                })
              } catch (err) {
                log.error("unexpected error when handling permission", { error: err })
              } finally {
                break
              }

            // 处理消息 part 更新事件
            case "message.part.updated":
              log.info("message part updated", { event: event.properties })
              try {
                const props = event.properties
                const { part } = props

                // 获取完整消息
                const message = await this.config.sdk.session
                  .message(
                    {
                      sessionID: part.sessionID,
                      messageID: part.messageID,
                      directory,
                    },
                    { throwOnError: true },
                  )
                  .then((x) => x.data)
                  .catch((err) => {
                    log.error("unexpected error when fetching message", { error: err })
                    return undefined
                  })

                // 只处理助手消息
                if (!message || message.info.role !== "assistant") return

                // 处理工具调用 part
                if (part.type === "tool") {
                  switch (part.state.status) {
                    case "pending":
                      await this.connection
                        .sessionUpdate({
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call",
                            toolCallId: part.callID,
                            title: part.tool,
                            kind: toToolKind(part.tool),
                            status: "pending",
                            locations: [],
                            rawInput: {},
                          },
                        })
                        .catch((err) => {
                          log.error("failed to send tool pending to ACP", { error: err })
                        })
                      break

                    case "running":
                      await this.connection
                        .sessionUpdate({
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "in_progress",
                            kind: toToolKind(part.tool),
                            title: part.tool,
                            locations: toLocations(part.tool, part.state.input),
                            rawInput: part.state.input,
                          },
                        })
                        .catch((err) => {
                          log.error("failed to send tool in_progress to ACP", { error: err })
                        })
                      break

                    case "completed":
                      const kind = toToolKind(part.tool)
                      const content: ToolCallContent[] = [
                        {
                          type: "content",
                          content: {
                            type: "text",
                            text: part.state.output,
                          },
                        },
                      ]

                      // 如果是编辑工具，添加差异信息
                      if (kind === "edit") {
                        const input = part.state.input
                        const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
                        const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
                        const newText =
                          typeof input["newString"] === "string"
                            ? input["newString"]
                            : typeof input["content"] === "string"
                              ? input["content"]
                              : ""
                        content.push({
                          type: "diff",
                          path: filePath,
                          oldText,
                          newText,
                        })
                      }

                      // 处理待办事项工具
                      if (part.tool === "todowrite") {
                        const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
                        if (parsedTodos.success) {
                          await this.connection
                            .sessionUpdate({
                              sessionId,
                              update: {
                                sessionUpdate: "plan",
                                entries: parsedTodos.data.map((todo) => {
                                  const status: PlanEntry["status"] =
                                    todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                                  return {
                                    priority: "medium",
                                    status,
                                    content: todo.content,
                                  }
                                }),
                              },
                            })
                            .catch((err) => {
                              log.error("failed to send session update for todo", { error: err })
                            })
                        } else {
                          log.error("failed to parse todo output", { error: parsedTodos.error })
                        }
                      }

                      // 发送完成状态
                      await this.connection
                        .sessionUpdate({
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "completed",
                            kind,
                            content,
                            title: part.state.title,
                            rawInput: part.state.input,
                            rawOutput: {
                              output: part.state.output,
                              metadata: part.state.metadata,
                            },
                          },
                        })
                        .catch((err) => {
                          log.error("failed to send tool completed to ACP", { error: err })
                        })
                      break

                    case "error":
                      await this.connection
                        .sessionUpdate({
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "failed",
                            kind: toToolKind(part.tool),
                            title: part.tool,
                            rawInput: part.state.input,
                            content: [
                              {
                                type: "content",
                                content: {
                                  type: "text",
                                  text: part.state.error,
                                },
                              },
                            ],
                            rawOutput: {
                              error: part.state.error,
                            },
                          },
                        })
                        .catch((err) => {
                          log.error("failed to send tool error to ACP", { error: err })
                        })
                      break
                  }
                } else if (part.type === "text") {
                  // 处理文本 part
                  const delta = props.delta
                  if (delta && part.synthetic !== true) {
                    await this.connection
                      .sessionUpdate({
                        sessionId,
                        update: {
                          sessionUpdate: "agent_message_chunk",
                          content: {
                            type: "text",
                            text: delta,
                          },
                        },
                      })
                      .catch((err) => {
                        log.error("failed to send text to ACP", { error: err })
                      })
                  }
                } else if (part.type === "reasoning") {
                  // 处理推理 part
                  const delta = props.delta
                  if (delta) {
                    await this.connection
                      .sessionUpdate({
                        sessionId,
                        update: {
                          sessionUpdate: "agent_thought_chunk",
                          content: {
                            type: "text",
                            text: delta,
                          },
                        },
                      })
                      .catch((err) => {
                        log.error("failed to send reasoning to ACP", { error: err })
                      })
                  }
                }
              } finally {
                break
              }
          }
        }
      })
    }

    /**
     * 初始化 ACP 连接
     *
     * 执行协议握手，返回 Agent 的能力和信息。
     *
     * @param params - 初始化请求参数
     * @returns 初始化响应
     */
    async initialize(params: InitializeRequest): Promise<InitializeResponse> {
      log.info("initialize", { protocolVersion: params.protocolVersion })

      // 定义认证方法
      const authMethod: AuthMethod = {
        description: "Run `opencode auth login` in the terminal",
        name: "Login with opencode",
        id: "opencode-login",
      }

      // 如果客户端支持 terminal-auth 能力，使用它
      if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
        authMethod._meta = {
          "terminal-auth": {
            command: "opencode",
            args: ["auth", "login"],
            label: "OpenCode Login",
          },
        }
      }

      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: {
            http: true,
            sse: true,
          },
          promptCapabilities: {
            embeddedContext: true,
            image: true,
          },
        },
        authMethods: [authMethod],
        agentInfo: {
          name: "OpenCode",
          version: Installation.VERSION,
        },
      }
    }

    /**
     * 认证（未实现）
     *
     * @param _params - 认证请求参数
     * @throws 认证未实现错误
     */
    async authenticate(_params: AuthenticateRequest) {
      throw new Error("Authentication not implemented")
    }

    /**
     * 创建新会话
     *
     * 创建新的 OpenCode 会话并设置 ACP 集成。
     *
     * @param params - 新会话请求参数
     * @returns 会话信息
     */
    async newSession(params: NewSessionRequest) {
      const directory = params.cwd
      try {
        // 获取默认模型
        const model = await defaultModel(this.config, directory)

        // 创建 ACP 会话状态
        const state = await this.sessionManager.create(params.cwd, params.mcpServers, model)
        const sessionId = state.id

        log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })

        // 加载会话模式（模型、Agent、命令等）
        const load = await this.loadSessionMode({
          cwd: directory,
          mcpServers: params.mcpServers,
          sessionId,
        })

        // 设置事件订阅
        this.setupEventSubscriptions(state)

        return {
          sessionId,
          models: load.models,
          modes: load.modes,
          _meta: {},
        }
      } catch (e) {
        // 处理认证错误
        const error = MessageV2.fromError(e, {
          providerID: this.config.defaultModel?.providerID ?? "unknown",
        })
        if (LoadAPIKeyError.isInstance(error)) {
          throw RequestError.authRequired()
        }
        throw e
      }
    }

    /**
     * 加载现有会话
     *
     * 加载 OpenCode 会话并回放历史消息。
     *
     * @param params - 加载会话请求参数
     * @returns 会话信息
     */
    async loadSession(params: LoadSessionRequest) {
      const directory = params.cwd
      const sessionId = params.sessionId

      try {
        // 获取默认模型
        const model = await defaultModel(this.config, directory)

        // 加载 ACP 会话状态
        const state = await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)

        log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })

        // 加载会话模式
        const mode = await this.loadSessionMode({
          cwd: directory,
          mcpServers: params.mcpServers,
          sessionId,
        })

        // 设置事件订阅
        this.setupEventSubscriptions(state)

        // 回放会话历史
        const messages = await this.sdk.session
          .messages(
            {
              sessionID: sessionId,
              directory,
            },
            { throwOnError: true },
          )
          .then((x) => x.data)
          .catch((err) => {
            log.error("unexpected error when fetching message", { error: err })
            return undefined
          })

        // 回放每条消息
        for (const msg of messages ?? []) {
          log.debug("replay message", msg)
          await this.processMessage(msg)
        }

        return mode
      } catch (e) {
        // 处理认证错误
        const error = MessageV2.fromError(e, {
          providerID: this.config.defaultModel?.providerID ?? "unknown",
        })
        if (LoadAPIKeyError.isInstance(error)) {
          throw RequestError.authRequired()
        }
        throw e
      }
    }

    /**
     * 处理消息（用于回放）
     *
     * 将历史消息转换为 ACP 协议消息并发送。
     *
     * @param message - 会话消息
     */
    private async processMessage(message: SessionMessageResponse) {
      log.debug("process message", message)
      if (message.info.role !== "assistant" && message.info.role !== "user") return
      const sessionId = message.info.sessionID

      for (const part of message.parts) {
        if (part.type === "tool") {
          switch (part.state.status) {
            case "pending":
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call",
                    toolCallId: part.callID,
                    title: part.tool,
                    kind: toToolKind(part.tool),
                    status: "pending",
                    locations: [],
                    rawInput: {},
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool pending to ACP", { error: err })
                })
              break

            case "running":
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "in_progress",
                    kind: toToolKind(part.tool),
                    title: part.tool,
                    locations: toLocations(part.tool, part.state.input),
                    rawInput: part.state.input,
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool in_progress to ACP", { error: err })
                })
              break

            case "completed":
              const kind = toToolKind(part.tool)
              const content: ToolCallContent[] = [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: part.state.output,
                  },
                },
              ]

              if (kind === "edit") {
                const input = part.state.input
                const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
                const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
                const newText =
                  typeof input["newString"] === "string"
                    ? input["newString"]
                    : typeof input["content"] === "string"
                      ? input["content"]
                      : ""
                content.push({
                  type: "diff",
                  path: filePath,
                  oldText,
                  newText,
                })
              }

              if (part.tool === "todowrite") {
                const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
                if (parsedTodos.success) {
                  await this.connection
                    .sessionUpdate({
                      sessionId,
                      update: {
                        sessionUpdate: "plan",
                        entries: parsedTodos.data.map((todo) => {
                          const status: PlanEntry["status"] =
                            todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                          return {
                            priority: "medium",
                            status,
                            content: todo.content,
                          }
                        }),
                      },
                    })
                    .catch((err) => {
                      log.error("failed to send session update for todo", { error: err })
                    })
                } else {
                  log.error("failed to parse todo output", { error: parsedTodos.error })
                }
              }

              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "completed",
                    kind,
                    content,
                    title: part.state.title,
                    rawInput: part.state.input,
                    rawOutput: {
                      output: part.state.output,
                      metadata: part.state.metadata,
                    },
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool completed to ACP", { error: err })
                })
              break

            case "error":
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "failed",
                    kind: toToolKind(part.tool),
                    title: part.tool,
                    rawInput: part.state.input,
                    content: [
                      {
                        type: "content",
                        content: {
                          type: "text",
                          text: part.state.error,
                        },
                      },
                    ],
                    rawOutput: {
                      error: part.state.error,
                    },
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool error to ACP", { error: err })
                })
              break
          }
        } else if (part.type === "text") {
          if (part.text) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                  content: {
                    type: "text",
                    text: part.text,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send text to ACP", { error: err })
              })
          }
        } else if (part.type === "reasoning") {
          if (part.text) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: {
                    type: "text",
                    text: part.text,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send reasoning to ACP", { error: err })
              })
          }
        }
      }
    }

    /**
     * 加载会话模式
     *
     * 获取可用的模型、Agent 和命令列表。
     *
     * @param params - 加载会话请求参数
     * @returns 会话模式信息
     */
    private async loadSessionMode(params: LoadSessionRequest) {
      const directory = params.cwd
      const model = await defaultModel(this.config, directory)
      const sessionId = params.sessionId

      // 获取提供商列表并排序
      const providers = await this.sdk.config.providers({ directory }).then((x) => x.data!.providers)
      const entries = providers.sort((a, b) => {
        const nameA = a.name.toLowerCase()
        const nameB = b.name.toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
      })

      // 构建可用模型列表
      const availableModels = entries.flatMap((provider) => {
        const models = Provider.sort(Object.values(provider.models))
        return models.map((model) => ({
          modelId: `${provider.id}/${model.id}`,
          name: `${provider.name}/${model.name}`,
        }))
      })

      // 获取 Agent 列表
      const agents = await this.config.sdk.app
        .agents(
          {
            directory,
          },
          { throwOnError: true },
        )
        .then((resp) => resp.data!)

      // 获取命令列表
      const commands = await this.config.sdk.command
        .list(
          {
            directory,
          },
          { throwOnError: true },
        )
        .then((resp) => resp.data!)

      const availableCommands = commands.map((command) => ({
        name: command.name,
        description: command.description ?? "",
      }))

      // 添加内置 compact 命令
      const names = new Set(availableCommands.map((c) => c.name))
      if (!names.has("compact"))
        availableCommands.push({
          name: "compact",
          description: "compact the session",
        })

      // 构建可用模式列表（过滤子 Agent 和隐藏的）
      const availableModes = agents
        .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
        .map((agent) => ({
          id: agent.name,
          name: agent.name,
          description: agent.description,
        }))

      // 获取默认 Agent
      const defaultAgentName = await AgentModule.defaultAgent()
      const currentModeId = availableModes.find((m) => m.name === defaultAgentName)?.id ?? availableModes[0].id

      // 转换 MCP 服务器配置
      const mcpServers: Record<string, Config.Mcp> = {}
      for (const server of params.mcpServers) {
        if ("type" in server) {
          mcpServers[server.name] = {
            url: server.url,
            headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
              acc[name] = value
              return acc
            }, {}),
            type: "remote",
          }
        } else {
          mcpServers[server.name] = {
            type: "local",
            command: [server.command, ...server.args],
            environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
              acc[name] = value
              return acc
            }, {}),
          }
        }
      }

      // 添加所有 MCP 服务器
      await Promise.all(
        Object.entries(mcpServers).map(async ([key, mcp]) => {
          await this.sdk.mcp
            .add(
              {
                directory,
                name: key,
                config: mcp,
              },
              { throwOnError: true },
            )
            .catch((error) => {
              log.error("failed to add mcp server", { name: key, error })
            })
        }),
      )

      // 延迟发送命令更新
      setTimeout(() => {
        this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands,
          },
        })
      }, 0)

      return {
        sessionId,
        models: {
          currentModelId: `${model.providerID}/${model.modelID}`,
          availableModels,
        },
        modes: {
          availableModes,
          currentModeId,
        },
        _meta: {},
      }
    }

    /**
     * 设置会话模型
     *
     * @param params - 设置模型请求参数
     * @returns 空响应
     */
    async setSessionModel(params: SetSessionModelRequest) {
      const session = this.sessionManager.get(params.sessionId)

      const model = Provider.parseModel(params.modelId)

      this.sessionManager.setModel(session.id, {
        providerID: model.providerID,
        modelID: model.modelID,
      })

      return {
        _meta: {},
      }
    }

    /**
     * 设置会话模式
     *
     * @param params - 设置模式请求参数
     * @returns 空响应
     */
    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
      this.sessionManager.get(params.sessionId)
      await this.config.sdk.app
        .agents({}, { throwOnError: true })
        .then((x) => x.data)
        .then((agent) => {
          if (!agent) throw new Error(`Agent not found: ${params.modeId}`)
        })
      this.sessionManager.setMode(params.sessionId, params.modeId)
    }

    /**
     * 发送用户提示
     *
     * 处理用户输入，支持文本、图片、资源链接等。
     *
     * @param params - 提示请求参数
     * @returns 提示响应
     */
    async prompt(params: PromptRequest) {
      const sessionID = params.sessionId
      const session = this.sessionManager.get(sessionID)
      const directory = session.cwd

      // 获取或使用默认模型
      const current = session.model
      const model = current ?? (await defaultModel(this.config, directory))
      if (!current) {
        this.sessionManager.setModel(session.id, model)
      }

      // 获取或使用默认 Agent
      const agent = session.modeId ?? (await AgentModule.defaultAgent())

      // 解析输入 parts
      const parts: Array<
        { type: "text"; text: string } | { type: "file"; url: string; filename: string; mime: string }
      > = []
      for (const part of params.prompt) {
        switch (part.type) {
          case "text":
            parts.push({
              type: "text" as const,
              text: part.text,
            })
            break

          case "image":
            if (part.data) {
              parts.push({
                type: "file",
                url: `data:${part.mimeType};base64,${part.data}`,
                filename: "image",
                mime: part.mimeType,
              })
            } else if (part.uri && part.uri.startsWith("http:")) {
              parts.push({
                type: "file",
                url: part.uri,
                filename: "image",
                mime: part.mimeType,
              })
            }
            break

          case "resource_link":
            const parsed = parseUri(part.uri)
            parts.push(parsed)
            break

          case "resource":
            const resource = part.resource
            if ("text" in resource) {
              parts.push({
                type: "text",
                text: resource.text,
              })
            }
            break

          default:
            break
        }
      }

      log.info("parts", { parts })

      // 解析命令（以 / 开头）
      const cmd = (() => {
        const text = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("")
          .trim()

        if (!text.startsWith("/")) return

        const [name, ...rest] = text.slice(1).split(/\s+/)
        return { name, args: rest.join(" ").trim() }
      })()

      const done = {
        stopReason: "end_turn" as const,
        _meta: {},
      }

      // 如果不是命令，发送普通提示
      if (!cmd) {
        await this.sdk.session.prompt({
          sessionID,
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
          parts,
          agent,
          directory,
        })
        return done
      }

      // 处理命令
      const command = await this.config.sdk.command
        .list({ directory }, { throwOnError: true })
        .then((x) => x.data!.find((c) => c.name === cmd.name))

      if (command) {
        await this.sdk.session.command({
          sessionID,
          command: command.name,
          arguments: cmd.args,
          model: model.providerID + "/" + model.modelID,
          agent,
          directory,
        })
        return done
      }

      // 处理内置命令
      switch (cmd.name) {
        case "compact":
          await this.config.sdk.session.summarize(
            {
              sessionID,
              directory,
              providerID: model.providerID,
              modelID: model.modelID,
            },
            { throwOnError: true },
          )
          break
      }

      return done
    }

    /**
     * 取消操作
     *
     * @param params - 取消通知参数
     */
    async cancel(params: CancelNotification) {
      const session = this.sessionManager.get(params.sessionId)
      await this.config.sdk.session.abort(
        {
          sessionID: params.sessionId,
          directory: session.cwd,
        },
        { throwOnError: true },
      )
    }
  }

  /**
   * 将工具名称转换为 ACP ToolKind
   *
   * @param toolName - 工具名称
   * @returns ACP ToolKind
   */
  function toToolKind(toolName: string): ToolKind {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
      case "bash":
        return "execute"
      case "webfetch":
        return "fetch"

      case "edit":
      case "patch":
      case "write":
        return "edit"

      case "grep":
      case "glob":
      case "context7_resolve_library_id":
      case "context7_get_library_docs":
        return "search"

      case "list":
      case "read":
        return "read"

      default:
        return "other"
    }
  }

  /**
   * 从工具输入提取位置信息
   *
   * @param toolName - 工具名称
   * @param input - 工具输入
   * @returns 位置列表
   */
  function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
      case "read":
      case "edit":
      case "write":
        return input["filePath"] ? [{ path: input["filePath"] }] : []
      case "glob":
      case "grep":
        return input["path"] ? [{ path: input["path"] }] : []
      case "bash":
        return []
      case "list":
        return input["path"] ? [{ path: input["path"] }] : []
      default:
        return []
    }
  }

  /**
   * 获取默认模型
   *
   * 按优先级返回默认模型：
   * 1. 配置的默认模型
   * 2. 用户配置的模型
   * 3. OpenCode 提供商的最佳模型
   * 4. 所有提供商的最佳模型
   * 5. big-pickle（兜底）
   *
   * @param config - ACP 配置
   * @param cwd - 可选的工作目录
   * @returns 模型配置
   */
  async function defaultModel(config: ACPConfig, cwd?: string) {
    const sdk = config.sdk
    const configured = config.defaultModel
    if (configured) return configured

    const directory = cwd ?? process.cwd()

    // 获取用户配置的模型
    const specified = await sdk.config
      .get({ directory }, { throwOnError: true })
      .then((resp) => {
        const cfg = resp.data
        if (!cfg || !cfg.model) return undefined
        const parsed = Provider.parseModel(cfg.model)
        return {
          providerID: parsed.providerID,
          modelID: parsed.modelID,
        }
      })
      .catch((error) => {
        log.error("failed to load user config for default model", { error })
        return undefined
      })

    // 获取所有提供商
    const providers = await sdk.config
      .providers({ directory }, { throwOnError: true })
      .then((x) => x.data?.providers ?? [])
      .catch((error) => {
        log.error("failed to list providers for default model", { error })
        return []
      })

    // 验证用户配置的模型是否存在
    if (specified && providers.length) {
      const provider = providers.find((p) => p.id === specified.providerID)
      if (provider && provider.models[specified.modelID]) return specified
    }

    if (specified && !providers.length) return specified

    // 优先使用 OpenCode 提供商
    const opencodeProvider = providers.find((p) => p.id === "opencode")
    if (opencodeProvider) {
      if (opencodeProvider.models["big-pickle"]) {
        return { providerID: "opencode", modelID: "big-pickle" }
      }
      const [best] = Provider.sort(Object.values(opencodeProvider.models))
      if (best) {
        return {
          providerID: best.providerID,
          modelID: best.id,
        }
      }
    }

    // 从所有提供商中选择最佳模型
    const models = providers.flatMap((p) => Object.values(p.models))
    const [best] = Provider.sort(models)
    if (best) {
      return {
        providerID: best.providerID,
        modelID: best.id,
      }
    }

    if (specified) return specified

    // 兜底返回 big-pickle
    return { providerID: "opencode", modelID: "big-pickle" }
  }

  /**
   * 解析 URI
   *
   * 支持 file://、zed:// 等协议。
   *
   * @param uri - URI 字符串
   * @returns 文件或文本对象
   */
  function parseUri(
    uri: string,
  ): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
    try {
      if (uri.startsWith("file://")) {
        const path = uri.slice(7)
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: uri,
          filename: name,
          mime: "text/plain",
        }
      }
      if (uri.startsWith("zed://")) {
        const url = new URL(uri)
        const path = url.searchParams.get("path")
        if (path) {
          const name = path.split("/").pop() || path
          return {
            type: "file",
            url: `file://${path}`,
            filename: name,
            mime: "text/plain",
          }
        }
      }
      return {
        type: "text",
        text: uri,
      }
    } catch {
      return {
        type: "text",
        text: uri,
      }
    }
  }

  /**
   * 应用差异获取新内容
   *
   * @param fileOriginal - 原始文件内容
   * @param unifiedDiff - 统一差异格式
   * @returns 新文件内容，失败返回 undefined
   */
  function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
    const result = applyPatch(fileOriginal, unifiedDiff)
    if (result === false) {
      log.error("Failed to apply unified diff (context mismatch)")
      return undefined
    }
    return result
  }
}
