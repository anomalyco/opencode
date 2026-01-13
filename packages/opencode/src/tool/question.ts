/**
 * ============================================================================
 * 文件名：question.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 问题工具模块。允许 AI 向用户提问以获取澄清或决策。
 *
 * 主要功能：
 * - QuestionTool：向用户提问的工具
 * - 支持多问题批量提问
 * - 格式化答案返回
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ../question：问题系统
 * - ./question.txt：工具描述模板
 *
 * 导出内容：
 * - QuestionTool：问题工具定义
 *
 * 参数：
 * - questions：问题数组（Question.Info）
 *
 * 返回：
 * - title：问题数量标题
 * - output：格式化的答案摘要
 * - metadata.answers：完整答案数组
 *
 * 使用场景：
 * - 需要用户选择时（如选择实现方式）
 * - 需要确认操作时（如删除文件前确认）
 * - 收集用户偏好
 *
 * @package opencode
 * @module tool/question
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入问题系统
import { Question } from "../question"

// 导入工具描述模板
import DESCRIPTION from "./question.txt"

/**
 * 问题工具定义
 *
 * 允许 AI 向用户提问并获取答案。
 */
export const QuestionTool = Tool.define("question", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 问题数组
    questions: z.array(Question.Info).describe("Questions to ask"),
  }),

  // 执行函数
  async execute(params, ctx) {
    // 调用问题系统获取答案
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      // 如果有调用 ID，关联到消息
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    // 格式化单个答案
    function format(answer: Question.Answer | undefined) {
      // 没有答案或答案为空
      if (!answer?.length) return "Unanswered"
      // 用逗号连接多个答案
      return answer.join(", ")
    }

    // 格式化所有问题和答案
    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")

    return {
      // 标题显示问题数量
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      // 输出答案摘要
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      // 元数据包含完整答案
      metadata: {
        answers,
      },
    }
  },
})
