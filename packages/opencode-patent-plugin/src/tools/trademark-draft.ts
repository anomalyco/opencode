/**
 * 商标申请撰写工具
 *
 * 5 步骤编排：理解 → 检索 → 商标说明 → 商品分类 → 整合
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { queryTrademarkExamGuide } from "../utils/obsidian-kb.js"
import { trademarkApplicationTemplate, trademarkDescriptionTemplate } from "../templates/trademark-application.js"

export async function registerTrademarkDraftTools(pluginContext: PatentPluginContext) {
  return {
    trademark_draft: tool({
      description: `
        商标注册申请撰写。从商标基本信息出发，逐步产出完整申请文件。

        支持的动作：
        - understand: 理解商标特征和指定商品/服务
        - search: 相同/近似商标检索
        - specification: 撰写商标说明
        - goods: 选择商品/服务类别和类似群
        - integrate: 整合申请文件
      `,
      args: {
        action: tool.schema.enum(["understand", "search", "specification", "goods", "integrate"]).describe("撰写动作"),
        disclosure: tool.schema.string().describe("商标申请信息"),
        trademark_type: tool.schema.enum(["文字", "图形", "组合", "立体", "颜色", "声音"]).optional().describe("商标类型"),
        context: tool.schema.string().optional().describe("额外上下文"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const { action, disclosure, trademark_type = "文字" } = args

        switch (action) {
          case "understand": return await trademarkDraftUnderstand(disclosure, trademark_type, pluginContext)
          case "search": return await trademarkDraftSearch(disclosure, pluginContext)
          case "specification": return await trademarkDraftSpecification(disclosure, trademark_type, pluginContext)
          case "goods": return await trademarkDraftGoods(disclosure, pluginContext)
          case "integrate": return await trademarkDraftIntegrate(disclosure, trademark_type, pluginContext)
          default: return `未知的撰写动作: ${action}`
        }
      },
    }),
  }
}

async function trademarkDraftUnderstand(disclosure: string, tmType: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标申请专家。从申请人提供的信息中提取结构化商标信息。" },
      {
        role: "user",
        content: `请分析以下商标申请信息：

**商标类型**：${tmType}

**申请信息**：
${disclosure}

请提取：
1. 商标名称/内容
2. 商标含义和设计理念
3. 指定使用的商品/服务
4. 可能涉及的商品/服务类别（尼斯分类）
5. 商标显著性初步评估
6. 潜在风险点（如与已有商标可能近似、缺乏显著性等）`,
      },
    ],
  })
  return `## 步骤 1/5：商标理解 ✅\n\n${response.content}\n\n---\n\n*请确认以上理解是否准确。确认后将继续步骤 2：近似商标检索。*`
}

async function trademarkDraftSearch(disclosure: string, pluginContext: PatentPluginContext) {
  // LLM 提取检索关键词
  const kwResponse = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标检索专家。提取商标名称和关键词用于近似检索。只返回 JSON。" },
      {
        role: "user",
        content: `从以下商标信息中提取检索关键词：\n\n${disclosure.slice(0, 1000)}\n\n返回 JSON：{"keywords": ["关键词1", ...], "classes": [9, 42], "similar_groups": ["0901", "0907"]}`,
      },
    ],
    temperature: 0.2,
  })

  let keywords: string[] = []
  try {
    const jsonMatch = kwResponse.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) keywords = JSON.parse(jsonMatch[0]).keywords || []
  } catch { /* ignore */ }

  let output = `## 步骤 2/5：近似商标检索 ✅\n\n`
  output += `**检索关键词**：${keywords.join("、")}\n\n`

  // 查询审查实例（并行查询，避免 N+1）
  let hasData = false
  const results = await Promise.allSettled(
    keywords.slice(0, 3).map(kw => queryTrademarkExamGuide(kw))
  )
  for (const result of results) {
    if (result.status === "fulfilled" && result.value && !result.value.includes("未在商标审查指南中找到")) {
      output += result.value + "\n"
      hasData = true
    }
  }

  if (!hasData) {
    output += `> 知识库中未找到相关审查实例。建议在 CTMO 商标查询系统进行检索。\n`
  }

  output += `\n---\n\n*请确认检索结果。确认后将继续步骤 3：商标说明撰写。*`
  return output
}

async function trademarkDraftSpecification(disclosure: string, tmType: string, pluginContext: PatentPluginContext) {
  const templateRef = trademarkDescriptionTemplate(tmType)

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标说明撰写专家。按提供的模板结构撰写商标说明。" },
      {
        role: "user",
        content: `请为以下商标撰写商标说明：

**商标类型**：${tmType}
**申请信息**：${disclosure}

**商标说明模板参考**（遵循此结构）：
${templateRef}

请生成完整的商标说明文本。`,
      },
    ],
  })
  return `## 步骤 3/5：商标说明撰写 ✅\n\n${response.content}\n\n---\n\n*请审阅商标说明。确认后将继续步骤 4：商品分类选择。*`
}

async function trademarkDraftGoods(disclosure: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标分类专家。熟悉尼斯分类和类似商品和服务区分表。" },
      {
        role: "user",
        content: `请为以下商标申请选择商品/服务类别：

${disclosure}

请输出：
1. 推荐的类别和类似群组
2. 每个类别下的具体商品/服务项目（使用规范表述）
3. 核心商品和扩展保护建议

格式：
### 第[N]类
| 序号 | 商品/服务名称 | 类似群 | 备注 |
|------|-------------|--------|------|`,
      },
    ],
  })
  return `## 步骤 4/5：商品分类选择 ✅\n\n${response.content}\n\n---\n\n*请确认商品/服务分类。确认后将继续步骤 5：整合申请文件。*`
}

async function trademarkDraftIntegrate(disclosure: string, tmType: string, pluginContext: PatentPluginContext) {
  const templateRef = trademarkApplicationTemplate()

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标申请文件整合专家。将各部分整合为完整的商标注册申请书。" },
      {
        role: "user",
        content: `请将以下内容整合为完整的商标注册申请书：

**商标类型**：${tmType}

**申请信息**：
${disclosure}

**申请书模板参考**：
${templateRef}

请按模板结构输出完整申请书。`,
      },
    ],
    maxTokens: 4096,
  })
  return `## 步骤 5/5：申请文件整合 ✅\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。建议使用 \`trademark_analyze\` 进行显著性/近似分析。`
}
