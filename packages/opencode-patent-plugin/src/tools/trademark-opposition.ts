/**
 * 商标异议/评审工具
 *
 * 攻守双向：异议人（提出异议） / 被异议人（异议答辩）
 * 动作：parse → analyze → oppose/defend → evidence
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { getTrademarkKBData } from "../utils/trademark-kb.js"
import { trademarkOppositionTemplate, trademarkDefenseTemplate, TRADEMARK_OPPOSITION_GROUNDS } from "../templates/trademark.js"

export async function registerTrademarkOppositionTools(pluginContext: PatentPluginContext) {
  return {
    trademark_opposition: tool({
      description: `
        商标异议与答辩。支持攻守双向操作。

        支持的动作：
        - parse: 解析异议通知书/答辩通知书
        - analyze: 分析异议理由和法律依据
        - oppose: 撰写异议申请书（异议人视角）
        - defend: 撰写异议答辩意见（被异议人视角）
        - evidence: 整理和组织证据清单
      `,
      args: {
        action: tool.schema.enum(["parse", "analyze", "oppose", "defend", "evidence"]).describe("异议动作"),
        target_trademark: tool.schema.string().describe("目标商标"),
        role: tool.schema.enum(["异议人", "被异议人"]).optional().describe("角色（oppose/defend 时必填）"),
        grounds: tool.schema.string().optional().describe("异议理由"),
        evidence: tool.schema.string().optional().describe("证据材料"),
        context: tool.schema.string().optional().describe("额外上下文"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action, role: args.role },
        })

        const { action, target_trademark, role = "异议人", grounds = "", evidence = "", context = "" } = args

        switch (action) {
          case "parse": return await trademarkOppositionParse(target_trademark, context, pluginContext)
          case "analyze": return await trademarkOppositionAnalyze(target_trademark, grounds, context, pluginContext)
          case "oppose": return await trademarkOppositionOppose(target_trademark, grounds, evidence, context, pluginContext)
          case "defend": return await trademarkOppositionDefend(target_trademark, grounds, evidence, context, pluginContext)
          case "evidence": return await trademarkOppositionEvidence(target_trademark, evidence, role, context, pluginContext)
          default: return `未知的异议动作: ${action}`
        }
      },
    }),
  }
}

async function trademarkOppositionParse(target: string, context: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标异议程序专家。解析异议或答辩通知，提取关键信息。" },
      {
        role: "user",
        content: `请解析以下商标异议相关文件：

**目标商标**：${target}
${context ? `**通知/文件内容**：\n${context}\n\n` : ""}
请提取：
1. 商标基本信息（名称、类别、申请号）
2. 异议/答辩期限
3. 关键事实要点
4. 涉及的法律条款
5. 需要准备的应对材料`,
      },
    ],
  })
  return `## 商标异议文件解析\n\n${response.content}\n\n---\n\n*解析完成。请确认后继续分析异议理由。*`
}

async function trademarkOppositionAnalyze(target: string, grounds: string, context: string, pluginContext: PatentPluginContext) {
  const kbData = await getTrademarkKBData("异议")

  const groundsList = TRADEMARK_OPPOSITION_GROUNDS.map(g => `- ${g.article} ${g.label}：${g.desc}`).join("\n")

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标异议分析专家。依据商标法第33条和相关审查指南分析异议理由。" },
      {
        role: "user",
        content: `请分析以下商标异议理由：

**目标商标**：${target}
**异议理由**：${grounds || "需根据商标信息分析适用理由"}
${context ? `**上下文**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
**可用的异议理由**（商标法第33条）：
${groundsList}

请分析：
1. 可适用/已适用的异议理由（相对理由 + 绝对理由）
2. 每条理由的法律依据和构成要件
3. 证据需求分析
4. 异议成功可能性评估
5. 建议的异议策略（如为异议人）或答辩策略（如为被异议人）`,
      },
    ],
  })
  return `## 商标异议理由分析\n\n${response.content}\n\n---\n\n*分析完成。确认后可继续撰写异议申请书或答辩意见。*`
}

async function trademarkOppositionOppose(
  target: string,
  grounds: string,
  evidence: string,
  context: string,
  pluginContext: PatentPluginContext,
) {
  const kbData = await getTrademarkKBData("异议")
  const templateRef = trademarkOppositionTemplate()

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标异议申请书撰写专家。按提供的模板结构撰写异议申请。" },
      {
        role: "user",
        content: `请为以下商标撰写异议申请书：

**目标商标**：${target}
**异议理由**：${grounds}
${evidence ? `**证据材料**：\n${evidence}\n\n` : ""}
${context ? `**上下文**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
**异议申请书模板**：
${templateRef}

请按模板结构生成完整的商标异议申请书。`,
      },
    ],
    maxTokens: 4096,
  })
  return `## 商标异议申请书\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。建议使用 \`trademark_analyze\` 进行近似/显著性分析补充论据。`
}

async function trademarkOppositionDefend(
  target: string,
  grounds: string,
  evidence: string,
  context: string,
  pluginContext: PatentPluginContext,
) {
  const kbData = await getTrademarkKBData("异议答辩")
  const templateRef = trademarkDefenseTemplate()

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标异议答辩专家。按提供的模板结构撰写答辩意见。" },
      {
        role: "user",
        content: `请为以下商标撰写异议答辩意见：

**目标商标**：${target}
**异议理由**：${grounds}
${evidence ? `**证据材料**：\n${evidence}\n\n` : ""}
${context ? `**上下文**：${context}\n\n` : ""}
${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
**答辩意见模板**：
${templateRef}

请按模板结构逐条反驳异议理由，生成完整的答辩意见。`,
      },
    ],
    maxTokens: 4096,
  })
  return `## 商标异议答辩意见\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。`
}

async function trademarkOppositionEvidence(
  target: string,
  evidence: string,
  role: string,
  context: string,
  pluginContext: PatentPluginContext,
) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标异议证据专家。为${role}整理和组织证据材料。` },
      {
        role: "user",
        content: `请为以下商标异议案件整理证据清单：

**目标商标**：${target}
**角色**：${role}
**已有证据**：${evidence || "暂无，请建议需要准备的证据"}
${context ? `**上下文**：${context}\n\n` : ""}
请：
1. 列出已有证据并评估证明力
2. 建议补充的证据材料
3. 证据的组织和编排方案
4. 各证据对应的证明目的

输出格式：
| 序号 | 证据名称 | 证据类型 | 证明目的 | 证明力评估 | 备注 |
|------|---------|---------|---------|-----------|------|`,
      },
    ],
  })
  return `## 商标异议证据清单（${role}视角）\n\n${response.content}\n\n---\n\n*证据清单已整理。请补充实际证据材料后继续撰写异议/答辩文件。*`
}
