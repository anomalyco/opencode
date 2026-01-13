/**
 * ============================================================================
 * 文件名：summary.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话摘要模块。生成会话和消息的摘要信息，
 * 包括代码变更统计和消息标题生成。
 *
 * 主要功能：
 * - summarize(input)：生成会话和消息摘要
 * - diff(input)：获取会话的代码差异
 * - computeDiff(input)：计算消息的代码差异
 * - summarizeSession()：生成会话摘要
 * - summarizeMessage()：生成消息摘要
 *
 * 依赖关系：
 * - ../provider/provider：提供商管理
 * - ../util/fn：函数工具
 * - zod：类型验证
 * - .：会话管理
 * - ./message-v2：消息模型
 * - ../id/id：标识符生成
 * - ../snapshot：快照和差异
 * - ../util/log：日志记录
 * - path：路径处理
 * - ../project/instance：实例管理
 * - ../storage/storage：持久化存储
 * - ../bus：事件总线
 * - ./llm：LLM 流式输出
 * - ../agent/agent：Agent 管理
 *
 * 导出内容：
 * - SessionSummary namespace：会话摘要命名空间
 *   - summarize()：生成摘要
 *   - diff()：获取代码差异
 *
 * 摘要内容：
 * - 会话级别：新增行数、删除行数、修改文件数
 * - 消息级别：代码差异列表、消息标题
 *
 * @package opencode
 * @module session/summary
 */

// 导入提供商管理
import { Provider } from "@/provider/provider"

// 导入函数工具
import { fn } from "@/util/fn"

// 导入 Zod 类型验证
import z from "zod"

// 导入会话管理
import { Session } from "."

// 导入消息模型
import { MessageV2 } from "./message-v2"

// 导入标识符生成器
import { Identifier } from "@/id/id"

// 导入快照管理
import { Snapshot } from "@/snapshot"

// 导入日志工具
import { Log } from "../util/log"

// 导入路径模块
import path from "path"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入存储模块
import { Storage } from "../storage/storage"

// 导入事件总线
import { Bus } from "../bus"

// 导入 LLM 流式输出
import { LLM } from "./llm"

// 导入 Agent 管理
import { Agent } from "@/agent/agent"

/**
 * 会话摘要命名空间
 *
 * 生成会话和消息的摘要信息。
 */
export namespace SessionSummary {
  // 创建日志记录器
  const log = Log.create({ service: "session.summary" })

  /**
   * 生成摘要
   *
   * 同时生成会话级别和消息级别的摘要。
   *
   * @param input - 摘要参数
   *   - sessionID：会话 ID
   *   - messageID：消息 ID
   * @returns Promise
   *
   * 处理流程：
   * 1. 获取会话的所有消息
   * 2. 并行生成会话摘要和消息摘要
   */
  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      // 获取所有消息
      const all = await Session.messages({ sessionID: input.sessionID })

      // 并行生成会话和消息摘要
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ])
    },
  )

  /**
   * 生成会话摘要
   *
   * 计算会话的代码变更统计。
   *
   * @param input - 会话摘要参数
   *   - sessionID：会话 ID
   *   - messages：消息列表
   * @returns Promise
   *
   * 摘要内容：
   * - 新增行数（additions）
   * - 删除行数（deletions）
   * - 修改文件数（files）
   */
  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    // 收集所有修改的文件（相对于工作树）
    const files = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === "patch")
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x)),
    )

    // 计算代码差异并过滤出修改的文件
    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((x) => {
        return files.has(x.file)
      }),
    )

    // 更新会话摘要
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        // 累计新增行数
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        // 累计删除行数
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        // 修改文件数
        files: diffs.length,
      }
    })

    // 保存差异到存储
    await Storage.write(["session_diff", input.sessionID], diffs)

    // 发布差异事件
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  /**
   * 生成消息摘要
   *
   * 计算消息的代码差异并生成消息标题。
   *
   * @param input - 消息摘要参数
   *   - messageID：消息 ID
   *   - messages：消息列表
   * @returns Promise
   *
   * 摘要内容：
   * - 代码差异列表
   * - 消息标题（如果没有）
   */
  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    // 获取用户消息和对应的助手消息
    const messages = input.messages.filter(
      (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
    )
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)!
    const userMsg = msgWithParts.info as MessageV2.User

    // 计算代码差异
    const diffs = await computeDiff({ messages })

    // 更新用户消息摘要
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg)

    // 获取非合成的文本 part
    const textPart = msgWithParts.parts.find((p) => p.type === "text" && !p.synthetic) as MessageV2.TextPart

    // 如果有文本 part 且没有标题，生成标题
    if (textPart && !userMsg.summary?.title) {
      const agent = await Agent.get("title")

      // 使用 LLM 生成标题
      const stream = await LLM.stream({
        agent,
        user: userMsg,
        tools: {},
        model: agent.model
          ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
          : ((await Provider.getSmallModel(userMsg.model.providerID)) ??
            (await Provider.getModel(userMsg.model.providerID, userMsg.model.modelID))),
        small: true,
        messages: [
          {
            role: "user" as const,
            content: `
              The following is the text to summarize:
              <text>
              ${textPart?.text ?? ""}
              </text>
            `,
          },
        ],
        abort: new AbortController().signal,
        sessionID: userMsg.sessionID,
        system: [],
        retries: 3,
      })

      // 获取生成的标题
      const result = await stream.text
      log.info("title", { title: result })

      // 更新用户消息标题
      userMsg.summary.title = result
      await Session.updateMessage(userMsg)
    }
  }

  /**
   * 获取会话的代码差异
   *
   * 从存储中读取之前计算的差异。
   *
   * @param input - 输入参数
   *   - sessionID：会话 ID
   *   - messageID：可选的消息 ID
   * @returns Promise，解析为差异列表
   */
  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      return Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
    },
  )

  /**
   * 计算消息的代码差异
   *
   * 从快照中计算代码差异。
   *
   * @param input - 计算参数
   *   - messages：消息列表
   * @returns Promise，解析为差异列表
   *
   * 计算逻辑：
   * 1. 找到最早的 step-start 快照（from）
   * 2. 找到最晚的 step-finish 快照（to）
   * 3. 计算两个快照之间的完整差异
   */
  async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    // 扫描助手消息，找到最早和最晚的快照
    for (const item of input.messages) {
      // 找到第一个 step-start 快照
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      // 找到最后一个 step-finish 快照
      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
          break
        }
      }
    }

    // 如果有两个快照，计算完整差异
    if (from && to) return Snapshot.diffFull(from, to)

    // 没有足够的快照
    return []
  }
}
