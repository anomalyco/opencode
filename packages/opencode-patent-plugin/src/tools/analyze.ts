/**
 * Patent Analyze Tools
 *
 * 封装 YunPat 专利分析能力为 OpenCode Plugin Tools
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"
import { createSharedAgentContext } from "../utils/agent-factory.js"
import { isAgentAvailable } from "../utils/agent-health.js"

/**
 * 注册专利分析工具集
 */
export async function registerAnalyzeTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利分析（新颖性/创造性/侵权等）
     */
    patent_analyze: tool({
      description: `
        专利技术分析。包括新颖性分析、创造性分析、侵权分析、保护范围分析等。

        支持的动作：
        - novelty: 新颖性分析（单独对比原则）
        - creativity: 创造性分析（三步法）
        - compare: 特征对比分析
        - scope: 保护范围分析
        - drawing: 附图分析（支持图片描述输入）
        - claim_interpretation: 权利要求解释
        - infringement: 侵权分析
      `,
      args: {
        action: tool.schema.enum(["novelty", "creativity", "compare", "scope", "drawing", "claim_interpretation", "infringement"]).describe("分析动作"),
        target: tool.schema.string().describe("目标专利文本或专利号"),
        reference: tool.schema.string().optional().describe("对比文件或参考专利"),
        context: tool.schema.string().optional().describe("额外上下文"),
      },
      async execute(args, ctx) {
        const { action, target, reference = "", context: extraContext = "" } = args

        ctx.metadata({
          title: `专利分析: ${action}`,
          metadata: { action },
        })

        // 绘图分析：优先使用 DrawingUnderstandingAgent
        if (action === "drawing") {
          const drawingResult = await runDrawingAgent(target, extraContext, pluginContext)
          if (drawingResult) return drawingResult
        }

        // 尝试使用 YunPat ComparisonAnalyzerAgent（对比分析）
        if (action === "compare" || action === "novelty" || action === "creativity") {
          try {
            const result = await runComparisonAnalyzer(action, target, reference, extraContext, pluginContext)
            if (result) return result
          } catch (error: any) {
            console.warn("[YunPat] ComparisonAnalyzerAgent error, falling back to LLM:", error?.message)
          }
        }

        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: buildAnalyzeSystemPrompt(action) },
            { role: "user", content: buildAnalyzeUserPrompt(action, target, reference, extraContext) },
          ],
        })

        return response.content
      },
    }),
  }
}

async function runComparisonAnalyzer(
  action: string,
  target: string,
  reference: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
): Promise<string | null> {
  const available = await isAgentAvailable("agents/patent-analyzer", "ComparisonAnalyzerAgent")
  if (!available) return null

  const mod = await loadYunPatModule("agents/patent-analyzer")
  if (!mod?.ComparisonAnalyzerAgent) return null

  const context = await createSharedAgentContext()
  if (!context) return null

  const agent = new mod.ComparisonAnalyzerAgent({
    llm: pluginContext.llm,
    eventBus: context.eventBus,
    memory: context.memory,
    tools: context.tools,
  })

  const result = await agent.run(
    {
      targetPatent: target,
      referencePatents: reference ? [reference] : [],
      analysisType: action,
      context: extraContext,
    },
    context,
  )

  if (!result.success) return null

  const actionLabels: Record<string, string> = {
    compare: "特征对比分析",
    novelty: "新颖性分析",
    creativity: "创造性分析",
  }
  const label = actionLabels[action] ?? action
  return `## ${label} ✅\n\n${result.data?.report || result.data?.content || JSON.stringify(result.data, null, 2)}`
}

/**
 * 绘图分析 Agent
 *
 * 使用 DrawingUnderstandingAgent 分析附图描述。
 * 如果 Agent 不可用，降级为 LLM 分析。
 */
async function runDrawingAgent(
  target: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
): Promise<string | null> {
  const available = await isAgentAvailable("agents/image-understanding", "DrawingUnderstandingAgent")
  if (!available) return null

  try {
    const mod = await loadYunPatModule("agents/image-understanding")
    if (!mod?.DrawingUnderstandingAgent) return null

    const context = await createSharedAgentContext()
    if (!context) return null

    const agent = new mod.DrawingUnderstandingAgent({
      llm: pluginContext.llm,
      eventBus: context.eventBus,
      memory: context.memory,
      tools: context.tools,
    })

    const result = await agent.run(
      { imageDescription: target, context: extraContext },
      context,
    )

    if (!result.success) return null

    return `## 附图分析 ✅（DrawingUnderstandingAgent）\n\n${result.data?.report || result.data?.content || result.data?.description || JSON.stringify(result.data, null, 2)}`
  } catch (error: any) {
    console.warn("[YunPat] DrawingUnderstandingAgent error:", error?.message)
    return null
  }
}

function buildAnalyzeSystemPrompt(action: string): string {
  const prompts: Record<string, string> = {
    novelty: "你是专利新颖性分析专家。严格遵循单独对比原则（A22.2），逐特征比对。",
    creativity: "你是专利创造性分析专家。严格遵循三步法（A22.3）：确定最接近现有技术→确定区别特征和实际解决的技术问题→判断显而易见性。",
    compare: "你是专利特征对比分析专家。生成详细的特征对比矩阵。",
    scope: "你是专利保护范围分析专家。运用最宽合理解释原则。",
    drawing: "你是专利附图分析专家。可分析结构图、流程图、电路图、化学结构式。",
    claim_interpretation: "你是权利要求解释专家。运用最宽合理解释原则（BRI）。",
    infringement: "你是专利侵权分析专家。运用全面覆盖原则和等同原则。",
  }
  return prompts[action] ?? "你是专利技术分析专家。"
}

function buildAnalyzeUserPrompt(action: string, target: string, reference: string, context: string): string {
  const basePrompt = `**目标专利**：\n${target}\n`
  const refPrompt = reference ? `\n**对比文件/参考**：\n${reference}\n` : ""
  const ctxPrompt = context ? `\n**额外上下文**：\n${context}\n` : ""

  const actionPrompts: Record<string, string> = {
    novelty: "请进行新颖性分析（单独对比原则）：\n1. 将权利要求与每篇对比文件逐一比对\n2. 确认每个特征是否被公开\n3. 给出综合判断（完全公开/部分公开/未公开）",
    creativity: "请进行创造性分析（三步法）：\n1. 确定最接近现有技术\n2. 确定区别特征和实际解决的技术问题\n3. 判断显而易见性（技术启示分析 + 辅助因素）\n4. 给出结论",
    compare: "请生成特征对比矩阵：\n| 权利要求特征 | 对比文件1 | 对比文件2 | 对比结果 |",
    scope: "请分析保护范围：\n1. 权利要求特征分解\n2. 保护范围界定\n3. 弱点识别",
    drawing: "请分析附图：\n1. 图像描述\n2. 技术特征标注\n3. 与权利要求的特征对照",
    claim_interpretation: "请解释权利要求：\n1. 术语定义\n2. 保护范围界定\n3. 功能性特征的解释",
    infringement: "请进行侵权分析：\n1. 权利要求解释\n2. 技术特征分解\n3. 逐一比对（被诉产品 vs 权利要求）\n4. 等同原则分析\n5. 结论",
  }

  return basePrompt + refPrompt + ctxPrompt + "\n" + (actionPrompts[action] ?? "请进行技术分析。")
}
