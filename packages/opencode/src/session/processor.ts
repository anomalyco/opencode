import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    // 1) 作用: 初始化处理器状态；解释: 维护工具调用、快照与控制标记
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      // 2) 作用: 暴露当前 assistant 消息；解释: 供外部读取与更新
      get message() {
        return input.assistantMessage
      },
      // 3) 作用: 通过 toolCallId 取回 tool part；解释: 供工具执行回写状态
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        // 4) 作用: 启动处理流程；解释: 重置压缩标记并加载运行配置
        log.info("process")
        needsCompaction = false
        const config = await Config.get()
        const shouldBreak = config.experimental?.continue_loop_on_deny !== true
        const maxRetries = config.experimental?.chatMaxRetries
        // 5) 作用: 重试循环；解释: 处理模型错误与重试退避
        while (true) {
          try {
            // 6) 作用: 初始化本轮流状态；解释: 缓存文本 part 与推理段落
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            // 7) 作用: 拉起模型流；解释: 获取 fullStream 事件序列
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              // 8) 作用: 尊重中断；解释: 外部取消时立即抛错退出
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  // 9) 作用: 标记忙碌；解释: 模型开始响应
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  // 10) 作用: 建立推理分段；解释: 为 reasoning 流创建 part 容器
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  // 11) 作用: 累积推理增量；解释: 追加文本并流式写盘
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                  }
                  break

                case "reasoning-end":
                  // 12) 作用: 结束推理分段；解释: 收尾时间与元数据并持久化
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  // 13) 作用: 记录工具输入开始；解释: 建立 tool part 占位并挂起
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  // 14) 作用: 保留输入增量事件；解释: 目前未使用，留给模型实现差异
                  break

                case "tool-input-end":
                  // 15) 作用: 保留输入结束事件；解释: 目前未使用，留给模型实现差异
                  break

                case "tool-call": {
                  // 16) 作用: 开始执行工具；解释: 写入输入并标记 running
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    // 17) 作用: 检测 doom loop；解释: 连续同工具同入参触发权限确认
                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  // 18) 作用: 记录工具成功结果；解释: 写回输出并清理映射
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  // 19) 作用: 记录工具失败；解释: 写回错误并处理权限/提问阻断
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  // 20) 作用: 透传模型错误；解释: 交由外层捕获与重试处理
                  throw value.error

                case "start-step":
                  // 21) 作用: 记录步骤开始；解释: 生成快照并写 step-start part
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  // 22) 作用: 记录步骤结束；解释: 结算用量/成本、写 step-finish 与 patch
                  // 22.1) 作用: 挂载 finish 原因；解释: 保存模型给出的结束原因用于上层收敛判断
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  // 23) 作用: 初始化文本输出；解释: 准备 text part 容器
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  // 24) 作用: 追加文本输出；解释: 累积并流式落盘
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  // 25) 作用: 收尾文本输出；解释: 插件后处理、写盘并清空当前文本
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  // 26) 作用: 终止事件占位；解释: 由 finish-step 统一处理收尾
                  break

                default:
                  // 27) 作用: 记录未处理事件；解释: 便于排查新事件类型
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              // 28) 作用: 触发压缩提前退出；解释: 已溢出则停止继续消费流
              if (needsCompaction) break
            }
          } catch (e: any) {
            // 29) 作用: 处理错误与重试；解释: 构造标准错误并按策略退避
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const allowed = maxRetries === undefined || attempt <= maxRetries
              if (allowed) {
                const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
                SessionStatus.set(input.sessionID, {
                  type: "retry",
                  attempt,
                  message: retry,
                  next: Date.now() + delay,
                })
                await SessionRetry.sleep(delay, input.abort).catch(() => {})
                continue
              }
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          // 30) 作用: 兜底写 patch；解释: 异常退出时也尝试记录改动
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          // 31) 作用: 清理悬挂工具；解释: 未完成工具一律标记为 error
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          // 32) 作用: 结束消息；解释: 记录完成时间并落盘
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          // 33) 作用: 返回循环信号；解释: 根据状态决定 compact/stop/continue
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
