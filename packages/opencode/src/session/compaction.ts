/**
 * ============================================================================
 * 文件名：compaction.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话压缩模块。当会话的 token 使用量超过上下文限制时，
 * 对历史消息进行压缩和剪枝，以减少 token 使用量并保持会话可继续性。
 *
 * 主要功能：
 * - isOverflow(input)：检测会话是否超过上下文限制
 * - prune(input)：剪枝已完成的工具调用输出
 * - process(input)：执行会话压缩，生成摘要
 * - create()：创建压缩触发消息
 * - Event.Compacted：压缩完成事件
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义
 * - ../bus：事件总线
 * - .：会话管理
 * - ../id/id：标识符生成
 * - ../project/instance：实例管理
 * - ../provider/provider：提供商和模型管理
 * - ./message-v2：消息模型
 * - zod：类型验证
 * - ./prompt：会话提示词
 * - ../util/token：token 估算
 * - ../util/log：日志记录
 * - ./processor：会话处理器
 * - ../util/fn：函数工具
 * - ../agent/agent：Agent 管理
 * - ../plugin：插件系统
 * - ../config/config：配置系统
 *
 * 导出内容：
 * - SessionCompaction namespace：会话压缩命名空间
 *   - Event：压缩事件
 *   - isOverflow()：检测是否溢出
 *   - PRUNE_MINIMUM：最小剪枝 token 数
 *   - PRUNE_PROTECT：保护最近 N 个 token
 *   - prune()：剪枝工具调用
 *   - process()：执行压缩
 *   - create()：创建压缩触发器
 *
 * 压缩策略：
 * 1. 剪枝（Prune）：删除旧工具调用的输出内容
 * 2. 摘要（Summarize）：使用 AI 生成会话摘要
 *
 * @package opencode
 * @module session/compaction
 */

// 导入事件定义
import { BusEvent } from "@/bus/bus-event"

// 导入事件总线
import { Bus } from "@/bus"

// 导入会话管理
import { Session } from "."

// 导入标识符生成器
import { Identifier } from "../id/id"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入提供商管理
import { Provider } from "../provider/provider"

// 导入消息模型
import { MessageV2 } from "./message-v2"

// 导入 Zod 类型验证
import z from "zod"

// 导入会话提示词
import { SessionPrompt } from "./prompt"

// 导入 token 估算工具
import { Token } from "../util/token"

// 导入日志工具
import { Log } from "../util/log"

// 导入会话处理器
import { SessionProcessor } from "./processor"

// 导入函数工具
import { fn } from "@/util/fn"

// 导入 Agent 管理
import { Agent } from "@/agent/agent"

// 导入插件系统
import { Plugin } from "@/plugin"

// 导入配置系统
import { Config } from "@/config/config"

/**
 * 会话压缩命名空间
 *
 * 处理会话 token 限制，通过剪枝和摘要保持会话可继续性。
 */
export namespace SessionCompaction {
  // 创建日志记录器
  const log = Log.create({ service: "session.compaction" })

  /**
   * 压缩事件
   *
   * 定义与压缩相关的事件。
   */
  export const Event = {
    /**
     * 压缩完成事件
     *
     * 当会话压缩完成时发布。
     */
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        // 会话 ID
        sessionID: z.string(),
      }),
    ),
  }

  /**
   * 检测会话是否超过上下文限制
   *
   * 比较实际 token 使用量与模型上下文限制。
   *
   * @param input - 检测参数
   *   - tokens：消息的 token 统计
   *   - model：使用的模型
   * @returns Promise，解析为是否溢出
   *
   * 计算逻辑：
   * 1. 检查是否禁用自动压缩
   * 2. 检查模型是否有上下文限制
   * 3. 计算总 token 数（输入 + 缓存读取 + 输出）
   * 4. 计算可用 token 数（上下文 - 输出预留）
   * 5. 判断是否溢出
   */
  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    // 获取配置
    const config = await Config.get()

    // 如果禁用自动压缩，返回 false
    if (config.compaction?.auto === false) return false

    // 获取模型上下文限制
    const context = input.model.limit.context

    // 如果没有上下文限制（如流式模型），返回 false
    if (context === 0) return false

    // 计算总 token 使用量
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output

    // 计算输出预留 token 数（模型限制和全局限制取最小值）
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX

    // 计算可用 token 数
    const usable = context - output

    // 判断是否溢出
    return count > usable
  }

  /**
   * 最小剪枝 token 数
   *
   * 只有当可剪枝的 token 超过此值时才执行剪枝。
   */
  export const PRUNE_MINIMUM = 20_000

  /**
   * 保护 token 数
   *
   * 保留最近的 N 个 token，只剪枝更早的内容。
   */
  export const PRUNE_PROTECT = 40_000

  /**
   * 受保护的工具列表
   *
   * 这些工具的输出不会被剪枝。
   * skill 工具的输出通常包含重要上下文，需要保留。
   */
  const PRUNE_PROTECTED_TOOLS = ["skill"]

  /**
   * 剪枝已完成的工具调用
   *
   * 从后向前遍历消息，保留最近 40,000 tokens 的工具调用，
   * 将更早的工具调用输出标记为已压缩。
   *
   * @param input - 剪枝参数
   *   - sessionID：会话 ID
   * @returns Promise
   *
   * 剪枝策略：
   * 1. 保留最近 2 轮对话
   * 2. 保留最近的 40,000 tokens
   * 3. 跳过摘要消息
   * 4. 跳过受保护工具
   * 5. 只剪枝已完成的工具调用
   * 6. 至少剪枝 20,000 tokens 才执行
   */
  export async function prune(input: { sessionID: string }) {
    // 获取配置
    const config = await Config.get()

    // 如果禁用剪枝，返回
    if (config.compaction?.prune === false) return

    // 记录开始
    log.info("pruning")

    // 获取会话的所有消息
    const msgs = await Session.messages({ sessionID: input.sessionID })

    // 累计 token 数（用于判断是否达到保护阈值）
    let total = 0

    // 可剪枝的 token 数
    let pruned = 0

    // 待剪枝的 part 列表
    const toPrune = []

    // 对话轮数计数
    let turns = 0

    // 从后向前遍历消息
    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]

      // 统计用户消息数（对话轮数）
      if (msg.info.role === "user") turns++

      // 保留最近 2 轮对话
      if (turns < 2) continue

      // 遇到摘要消息停止
      if (msg.info.role === "assistant" && msg.info.summary) break loop

      // 从后向前遍历消息的 parts
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]

        // 只处理工具调用
        if (part.type === "tool")
          // 只处理已完成的工具调用
          if (part.state.status === "completed") {
            // 跳过受保护的工具
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            // 如果已经压缩过，停止
            if (part.state.time.compacted) break loop

            // 估算此工具输出的 token 数
            const estimate = Token.estimate(part.state.output)

            // 累加到总数
            total += estimate

            // 如果超过保护阈值，加入剪枝列表
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }

    // 记录找到的可剪枝 token 数
    log.info("found", { pruned, total })

    // 只有当可剪枝数量超过最小值时才执行
    if (pruned > PRUNE_MINIMUM) {
      // 标记所有待剪枝的 part
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          // 设置压缩时间戳
          part.state.time.compacted = Date.now()
          // 更新 part
          await Session.updatePart(part)
        }
      }
      // 记录剪枝完成
      log.info("pruned", { count: toPrune.length })
    }
  }

  /**
   * 执行会话压缩
   *
   * 使用 AI 生成会话摘要，保留重要上下文信息。
   * 这是当会话超过上下文限制时的主要压缩手段。
   *
   * @param input - 压缩参数
   *   - parentID：父消息 ID
   *   - messages：消息列表
   *   - sessionID：会话 ID
   *   - abort：中止信号
   *   - auto：是否自动模式
   * @returns Promise，解析为 "continue" 或 "stop"
   *
   * 压缩流程：
   * 1. 获取压缩 Agent 和模型
   * 2. 创建助手消息用于存储摘要
   * 3. 触发插件钩子获取自定义上下文
   * 4. 使用 AI 生成会话摘要
   * 5. 如果 AI 返回 "continue"，添加继续提示
   * 6. 发布压缩完成事件
   */
  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    // 获取触发压缩的用户消息
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User

    // 获取压缩 Agent
    const agent = await Agent.get("compaction")

    // 确定使用的模型（Agent 模型优先，否则使用用户消息的模型）
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)

    // 创建助手消息用于存储摘要
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,                    // 标记为摘要消息
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant

    // 创建会话处理器
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })

    // 触发插件钩子，允许插件注入上下文或替换压缩提示词
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )

    // 默认压缩提示词
    const defaultPrompt =
      "Provide a detailed prompt for continuing our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next considering new session will not have access to our conversation."

    // 组合提示词（插件提示词优先）
    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")

    // 使用处理器生成摘要
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},                      // 压缩时不使用工具
      system: [],
      messages: [
        // 历史消息
        ...MessageV2.toModelMessage(input.messages),
        // 压缩提示
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    // 如果 AI 返回 "continue" 且是自动模式，添加继续提示消息
    if (result === "continue" && input.auto) {
      // 创建继续提示用户消息
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })

      // 添加继续提示 part
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,             // 标记为合成消息
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }

    // 如果处理出错，返回停止
    if (processor.message.error) return "stop"

    // 发布压缩完成事件
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })

    return "continue"
  }

  /**
   * 创建压缩触发器
   *
   * 创建一个压缩类型的 part，触发会话压缩流程。
   *
   * @param input - 触发器参数
   *   - sessionID：会话 ID
   *   - agent：Agent 名称
   *   - model：模型配置
   *   - auto：是否自动模式
   * @returns Promise
   *
   * 用途：
   * - 当会话超过上下文限制时，创建此触发器
   * - 触发器会被会话处理器检测并执行压缩
   */
  export const create = fn(
    z.object({
      // 会话 ID
      sessionID: Identifier.schema("session"),
      // Agent 名称
      agent: z.string(),
      // 模型配置
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      // 是否自动模式
      auto: z.boolean(),
    }),
    async (input) => {
      // 创建用户消息
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })

      // 创建压缩触发 part
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",           // 压缩类型
        auto: input.auto,             // 自动模式标志
      })
    },
  )
}
