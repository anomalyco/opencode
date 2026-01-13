/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/question
 * ============================================================================
 *
 * 文件作用：
 * 问题/提问管理模块。处理 AI 向用户提问的异步交互流程。
 *
 * 主要功能：
 * - ask()：向用户提问并等待回答
 * - reply()：用户回复答案
 * - reject()：用户拒绝回答问题
 * - list()：列出所有待处理问题
 * - 管理待处理问题的状态
 *
 * 依赖关系：
 * - @/bus：全局事件总线
 * - @/bus/bus-event：事件定义
 * - @/id/id：标识符生成
 * - @/project/instance：实例状态管理
 * - @/util/log：日志
 * - zod：类型验证
 *
 * 导出内容：
 * - Question namespace：问题管理命名空间
 *   - Option：选项 Zod schema
 *   - Info：问题信息 Zod schema
 *   - Request：请求 Zod schema
 *   - Answer：答案类型（字符串数组）
 *   - Reply：回复 Zod schema
 *   - Event：问题事件
 *   - RejectedError：拒绝回答错误
 *   - ask(input)：提问
 *   - reply(input)：回复
 *   - reject(requestID)：拒绝
 *   - list()：列出待处理问题
 *
 * 问题结构：
 * - question：完整问题文本
 * - header：简短标签（最多 12 字符）
 * - options：可选项列表（每个选项有 label 和 description）
 * - multiple：是否允许多选
 *
 * 答案格式：
 * - 单选：选项的 label 字符串数组（1 个元素）
 * - 多选：多个选项的 label 字符串数组
 *
 * 事件流：
 * 1. ask() → Event.Asked
 * 2. reply() → Event.Replied → Promise resolve
 * 3. reject() → Event.Rejected → Promise reject (RejectedError)
 *
 * @package opencode
 * @module question
 */

// 导入全局事件总线
import { Bus } from "@/bus"

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入标识符生成
import { Identifier } from "@/id/id"

// 导入实例状态管理
import { Instance } from "@/project/instance"

// 导入日志
import { Log } from "@/util/log"

// 导入 Zod 类型验证库
import z from "zod"

/**
 * 问题管理命名空间
 *
 * 包含所有问题/提问相关的功能。
 */
export namespace Question {
  // 创建问题服务日志记录器
  const log = Log.create({ service: "question" })

  /**
   * 问题选项 Zod Schema
   *
   * 描述问题的可选项。
   */
  export const Option = z
    .object({
      // 显示文本（1-5 个词，简洁）
      label: z.string().describe("Display text (1-5 words, concise)"),
      // 选项说明
      description: z.string().describe("Explanation of choice"),
    })
    .meta({
      ref: "QuestionOption",
    })
  export type Option = z.infer<typeof Option>

  /**
   * 问题信息 Zod Schema
   *
   * 描述单个问题的完整信息。
   */
  export const Info = z
    .object({
      // 完整问题文本
      question: z.string().describe("Complete question"),
      // 简短标签（最多 12 字符）
      header: z.string().max(12).describe("Very short label (max 12 chars)"),
      // 可选项列表
      options: z.array(Option).describe("Available choices"),
      // 是否允许多选
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
    })
    .meta({
      ref: "QuestionInfo",
    })
  export type Info = z.infer<typeof Info>

  /**
   * 问题请求 Zod Schema
   *
   * 描述一个问题请求。
   */
  export const Request = z
    .object({
      // 问题 ID（以 "que_" 开头）
      id: Identifier.schema("question"),
      // 会话 ID
      sessionID: Identifier.schema("session"),
      // 要问的问题列表
      questions: z.array(Info).describe("Questions to ask"),
      // 关联的工具调用（可选）
      tool: z
        .object({
          // 消息 ID
          messageID: z.string(),
          // 调用 ID
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "QuestionRequest",
    })
  export type Request = z.infer<typeof Request>

  /**
   * 答案类型
   *
   * 用户选择的结果，是选项 label 的数组。
   * 单选题：1 个元素的数组
   * 多选题：多个元素的数组
   */
  export const Answer = z.array(z.string()).meta({
    ref: "QuestionAnswer",
  })
  export type Answer = z.infer<typeof Answer>

  /**
   * 回复 Zod Schema
   *
   * 描述用户对所有问题的回答。
   */
  export const Reply = z.object({
    // 用户答案数组（按问题顺序，每个答案是选项 label 数组）
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  /**
   * 问题事件
   *
   * 定义问题相关的事件类型。
   */
  export const Event = {
    /**
     * 问题已提出事件
     *
     * 当向用户提出问题时触发。
     */
    Asked: BusEvent.define("question.asked", Request),

    /**
     * 问题已回复事件
     *
     * 当用户回复问题时触发。
     */
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        // 会话 ID
        sessionID: z.string(),
        // 请求 ID
        requestID: z.string(),
        // 用户答案
        answers: z.array(Answer),
      }),
    ),

    /**
     * 问题已拒绝事件
     *
     * 当用户拒绝回答问题时触发。
     */
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        // 会话 ID
        sessionID: z.string(),
        // 请求 ID
        requestID: z.string(),
      }),
    ),
  }

  /**
   * 问题状态
   *
   * 使用 Instance.state() 创建响应式状态。
   * 存储所有待处理的问题请求。
   */
  const state = Instance.state(async () => {
    // 待处理的问题映射
    const pending: Record<
      string,
      {
        // 问题信息
        info: Request
        // Promise resolve 函数
        resolve: (answers: Answer[]) => void
        // Promise reject 函数
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
    }
  })

  /**
   * 向用户提问
   *
   * 创建问题请求并等待用户回答。
   *
   * @param input - 提问参数
   * @returns Promise，解析为用户答案数组
   *
   * 流程：
   * 1. 生成问题 ID
   * 2. 创建 Promise 并存储 resolve/reject
   * 3. 发布 Asked 事件
   * 4. 等待 reply() 或 reject() 调用
   * 5. reply() 调用 resolve()
   * 6. reject() 调用 reject(RejectedError)
   */
  export async function ask(input: {
    sessionID: string
    questions: Info[]
    tool?: { messageID: string; callID: string }
  }): Promise<Answer[]> {
    const s = await state()
    // 生成问题 ID（递增）
    const id = Identifier.ascending("question")

    log.info("asking", { id, questions: input.questions.length })

    // 返回 Promise，等待用户回复
    return new Promise<Answer[]>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      // 存储待处理的问题
      s.pending[id] = {
        info,
        resolve,
        reject,
      }
      // 发布问题事件，通知 UI 显示问题
      Bus.publish(Event.Asked, info)
    })
  }

  /**
   * 回复问题
   *
   * 处理用户的答案回复。
   *
   * @param input - 回复参数
   *
   * 流程：
   * 1. 从 pending 中查找问题请求
   * 2. 如果未找到，记录警告并返回
   * 3. 从 pending 中移除
   * 4. 发布 Replied 事件
   * 5. 调用 resolve() 完成 Promise
   */
  export async function reply(input: { requestID: string; answers: Answer[] }): Promise<void> {
    const s = await state()
    // 查找待处理的问题
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    // 从待处理中移除
    delete s.pending[input.requestID]

    log.info("replied", { requestID: input.requestID, answers: input.answers })

    // 发布回复事件
    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      answers: input.answers,
    })

    // 完成 Promise
    existing.resolve(input.answers)
  }

  /**
   * 拒绝回答问题
   *
   * 处理用户拒绝回答问题的情况。
   *
   * @param requestID - 请求 ID
   *
   * 流程：
   * 1. 从 pending 中查找问题请求
   * 2. 如果未找到，记录警告并返回
   * 3. 从 pending 中移除
   * 4. 发布 Rejected 事件
   * 5. 调用 reject() 拒绝 Promise
   */
  export async function reject(requestID: string): Promise<void> {
    const s = await state()
    // 查找待处理的问题
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    // 从待处理中移除
    delete s.pending[requestID]

    log.info("rejected", { requestID })

    // 发布拒绝事件
    Bus.publish(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })

    // 拒绝 Promise
    existing.reject(new RejectedError())
  }

  /**
   * 问题拒绝错误
   *
   * 当用户拒绝回答问题时抛出。
   */
  export class RejectedError extends Error {
    constructor() {
      super("The user dismissed this question")
    }
  }

  /**
   * 列出所有待处理问题
   *
   * @returns Promise，解析为待处理问题请求列表
   */
  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
