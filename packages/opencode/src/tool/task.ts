/**
 * ============================================================================
 * 文件名：task.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Task 工具模块。允许 AI 启动子 Agent 处理特定任务。
 *
 * 主要功能：
 * - TaskTool：启动子会话的工具
 * - 创建新的会话或继续现有会话
 * - 订阅子会话的工具调用事件
 * - 实时更新元数据
 * - 支持取消操作
 *
 * 依赖关系：
 * - ./tool：工具基类
 * - ./task.txt：工具描述模板
 * - zod：类型验证
 * - ../session：会话管理
 * - ../bus：事件总线
 * - ../session/message-v2：消息类型
 * - ../id/id：标识符生成
 * - ../agent/agent：Agent 管理
 * - ../session/prompt：会话提示
 * - @/util/iife：IIFE 工具
 * - @/util/defer：延迟清理
 * - ../config/config：配置系统
 * - @/permission/next：权限评估
 *
 * 导出内容：
 * - TaskTool：任务工具定义
 *
 * 参数：
 * - description：任务简短描述（3-5 词）
 * - prompt：任务提示词
 * - subagent_type：子 Agent 类型
 * - session_id：可选的现有会话 ID（继续任务）
 * - command：触发此任务的命令（可选）
 *
 * 返回：
 * - title：任务描述
 * - output：子 Agent 输出 + 会话 ID
 * - metadata.summary：工具调用摘要
 * - metadata.sessionId：子会话 ID
 *
 * 权限处理：
 * - 检查子 Agent 访问权限
 * - 子会话默认禁止 todowrite/todoread
 * - 根据配置禁用 task 递归
 *
 * 取消支持：
 * - 监听 abort 信号
 * - 取消会话提示
 * - 清理事件监听器
 *
 * @package opencode
 * @module tool/task
 */

// 导入工具基类
import { Tool } from "./tool"

// 导入工具描述模板
import DESCRIPTION from "./task.txt"

// 导入 Zod 类型验证库
import z from "zod"

// 导入会话管理
import { Session } from "../session"

// 导入事件总线
import { Bus } from "../bus"

// 导入消息类型
import { MessageV2 } from "../session/message-v2"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入 Agent 管理
import { Agent } from "../agent/agent"

// 导入会话提示
import { SessionPrompt } from "../session/prompt"

// 导入 IIFE 工具
import { iife } from "@/util/iife"

// 导入延迟清理工具
import { defer } from "@/util/defer"

// 导入配置系统
import { Config } from "../config/config"

// 导入权限评估
import { PermissionNext } from "@/permission/next"

/**
 * 参数 Schema
 *
 * 定义任务工具所需的参数。
 */
const parameters = z.object({
  // 任务简短描述
  description: z.string().describe("A short (3-5 words) description of the task"),
  // 任务提示词
  prompt: z.string().describe("The task for the agent to perform"),
  // 子 Agent 类型
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  // 现有会话 ID（继续任务）
  session_id: z.string().describe("Existing Task session to continue").optional(),
  // 触发命令
  command: z.string().describe("The command that triggered this task").optional(),
})

/**
 * 任务工具定义
 *
 * 允许 AI 启动子 Agent 处理特定任务。
 */
export const TaskTool = Tool.define("task", async (ctx) => {
  // 获取所有子 Agent（排除主 Agent）
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // 根据权限过滤 Agent
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  // 生成工具描述（替换可用 Agent 列表）
  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // 请求任务权限（用户显式调用时跳过）
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      // 获取子 Agent
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // 检查子 Agent 是否有 task 权限
      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      // 创建或获取会话
      const session = await iife(async () => {
        // 如果提供了会话 ID，尝试获取现有会话
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        // 创建新会话
        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          // 子会话的权限配置
          permission: [
            // 默认禁止 todowrite
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            // 默认禁止 todoread
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            // 如果子 Agent 没有 task 权限，禁止递归
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            // 允许配置的主要工具
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })

      // 获取当前消息
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      // 更新工具调用元数据
      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
        },
      })

      // 创建消息 ID
      const messageID = Identifier.ascending("message")

      // 跟踪工具调用
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}

      // 订阅工具更新事件
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        // 过滤子会话的事件
        if (evt.properties.part.sessionID !== session.id) return
        // 跳过当前消息
        if (evt.properties.part.messageID === messageID) return
        // 只处理工具部分
        if (evt.properties.part.type !== "tool") return

        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }

        // 更新元数据
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

      // 确定模型配置
      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      // 取消函数
      function cancel() {
        SessionPrompt.cancel(session.id)
      }

      // 监听 abort 信号
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

      // 解析提示词部分
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // 执行提示
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        // 禁用部分工具
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      // 取消订阅
      unsub()

      // 获取会话消息摘要
      const messages = await Session.messages({ sessionID: session.id })
      const summary = messages
        .filter((x) => x.info.role === "assistant")
        .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
        .map((part) => ({
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }))

      // 获取最终文本输出
      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      // 添加会话 ID 到输出
      const output = text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")

      return {
        title: params.description,
        metadata: {
          summary,
          sessionId: session.id,
        },
        output,
      }
    },
  }
})
