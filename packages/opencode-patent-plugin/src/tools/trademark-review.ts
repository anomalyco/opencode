/**
 * 商标复审/撤销/无效工具
 *
 * 处理驳回复审、异议复审、无效宣告、撤销复审等后续程序。
 * 动作：parse → analyze → respond → revise → validate
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getTrademarkKBData } from "../utils/trademark-kb.js"
import { trademarkReviewRequestTemplate, trademarkInvalidationTemplate } from "../templates/trademark.js"

export async function registerTrademarkReviewTools(pluginContext: PatentPluginContext) {
  return {
    trademark_review: tool({
      description: `
        商标复审、撤销和无效程序。处理国家知识产权局各类决定书的应对。

        支持的动作：
        - parse: 解读驳回/异议/无效决定书
        - analyze: 分析决定要点和应对策略
        - respond: 撰写复审请求书/答辩书
        - revise: 根据反馈修改文书
        - validate: 检查文书的法律依据和格式
      `,
      args: {
        action: tool.schema.enum(["parse", "analyze", "respond", "revise", "validate"]).describe("复审动作"),
        review_document: tool.schema.string().describe("决定书/文书内容"),
        review_type: tool.schema.enum(["驳回复审", "异议复审", "无效宣告", "撤销复审"]).optional().describe("复审类型"),
        evidence: tool.schema.string().optional().describe("补充证据"),
        context: tool.schema.string().optional().describe("额外上下文"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action, reviewType: args.review_type },
        })

        const { action, review_document, review_type = "驳回复审", evidence = "", context = "" } = args

        switch (action) {
          case "parse": return await trademarkReviewParse(review_document, review_type, pluginContext)
          case "analyze": return await trademarkReviewAnalyze(review_document, review_type, context, pluginContext)
          case "respond": return await trademarkReviewRespond(review_document, review_type, evidence, context, pluginContext)
          case "revise": return await trademarkReviewRevise(review_document, review_type, evidence, context, pluginContext)
          case "validate": return await trademarkReviewValidate(review_document, review_type, pluginContext)
          default: return `未知的复审动作: ${action}`
        }
      },
    }),
  }
}

async function trademarkReviewParse(document: string, reviewType: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标${reviewType}专家。解析国家知识产权局决定书，提取关键信息。` },
      {
        role: "user",
        content: `请解析以下${reviewType}决定书：

**决定书内容**：
${document}

请提取：
1. 决定书文号和日期
2. 商标基本信息（名称、类别、注册号/申请号）
3. 原决定要点和理由
4. 引用的法律条款
5. 决定结论
6. 复审/诉讼期限
7. 需要应对的关键论点`,
      },
    ],
  })
  return `## ${reviewType}决定书解析\n\n${response.content}\n\n---\n\n*解析完成。请确认后继续分析应对策略。*`
}

async function trademarkReviewAnalyze(document: string, reviewType: string, context: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData(reviewType.includes("无效") ? "无效宣告" : "复审")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标${reviewType}分析专家。分析决定要点并制定应对策略。` },
      {
        role: "user",
        content: `请分析以下${reviewType}决定，制定应对策略：

**决定书内容**：
${document}
${context ? `\n**上下文**：${context}\n` : ""}
${kbData ? `\n**参考资料**：\n${kbData}\n` : ""}
请分析：
1. 原决定的法律依据是否准确
2. 事实认定是否存在争议空间
3. 可用的应对策略和论点
4. 需要补充的证据材料
5. 成功可能性评估
6. 推荐的应对方案（优先级排序）`,
      },
    ],
  })
  return `## ${reviewType}应对策略分析\n\n${response.content}\n\n---\n\n*策略分析完成。确认后可继续撰写复审请求书。*`
}

async function trademarkReviewRespond(
  document: string,
  reviewType: string,
  evidence: string,
  context: string,
  pluginContext: PatentPluginContext,
) {
  const kbData = await getTrademarkKBData(reviewType.includes("无效") ? "无效宣告" : "复审")
  const templateRef = reviewType === "无效宣告"
    ? trademarkInvalidationTemplate()
    : trademarkReviewRequestTemplate()

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标${reviewType}文书撰写专家。按模板结构撰写复审请求书。` },
      {
        role: "user",
        content: `请为以下${reviewType}撰写请求书：

**决定书内容**：
${document}

**复审类型**：${reviewType}
${evidence ? `**补充证据**：\n${evidence}\n\n` : ""}
${context ? `**上下文**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
**文书模板参考**：
${templateRef}

请按模板结构生成完整的${reviewType}请求书。`,
      },
    ],
    maxTokens: 4096,
  })
  return `## ${reviewType}请求书\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。`
}

async function trademarkReviewRevise(
  document: string,
  reviewType: string,
  evidence: string,
  context: string,
  pluginContext: PatentPluginContext,
) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标${reviewType}文书修订专家。根据反馈修改文书。` },
      {
        role: "user",
        content: `请根据以下反馈修订${reviewType}文书：

**原决定/文书内容**：
${document}
${evidence ? `\n**新补充的证据**：\n${evidence}\n` : ""}
${context ? `\n**修改要求/反馈**：\n${context}\n` : ""}
请修订文书，注意：
1. 针对反馈逐条修改
2. 补充新的论据和证据
3. 保持法律论述的准确性
4. 强化关键论点的论证`,
      },
    ],
    maxTokens: 4096,
  })
  return `## ${reviewType}文书修订\n\n${response.content}\n\n---\n\n⚠️ 修订稿仍需专业审校后提交。`
}

async function trademarkReviewValidate(document: string, reviewType: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData(reviewType.includes("无效") ? "无效宣告" : "复审")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标文书质量审查专家。检查文书的法律依据、逻辑和格式。" },
      {
        role: "user",
        content: `请审查以下${reviewType}文书的质量：

**文书内容**：
${document}

${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请检查：
1. **法律依据**：引用的法条是否准确、完整
2. **逻辑论证**：论证是否严密、有无逻辑漏洞
3. **事实陈述**：事实是否准确、有无遗漏
4. **证据关联**：证据与论点的对应关系是否清晰
5. **格式规范**：是否符合商标评审文书格式要求
6. **语言表达**：是否专业、清晰、无歧义

评分：⭐（1-5）
问题清单：
| 序号 | 问题类型 | 具体问题 | 修改建议 |
|------|---------|---------|---------|`,
      },
    ],
  })
  return `## ${reviewType}文书质量审查\n\n${response.content}`
}
