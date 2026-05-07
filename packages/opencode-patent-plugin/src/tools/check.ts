/**
 * Patent Check Tools
 *
 * 封装 YunPat 质量检查能力为 OpenCode Plugin Tools
 */

import { tool } from "@opencode-ai/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule, createAgentContext } from "../utils/yunpat-loader.js"
import { searchLegalRules } from "../utils/db.js"
import { queryGuidelinesFromKB } from "../utils/obsidian-kb.js"

/**
 * 注册质量检查工具集
 */
export async function registerCheckTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利质量检查（7 维度）
     */
    patent_check: tool({
      description: `
        专利文件质量检查。基于 7 维度评估体系自动检查并评分。

        支持的动作：
        - quality: 7 维度综合质量评估
        - subject_matter: 保护客体适格性检查
        - unity: 单一性检查
        - formality: 形式检查
        - consistency: 一致性检查（权利要求 vs 说明书）
      `,
      args: {
        action: tool.schema.enum(["quality", "subject_matter", "unity", "formality", "consistency"]).describe("检查动作"),
        document: tool.schema.string().describe("待检查的专利文件内容"),
        document_type: tool.schema.enum(["specification", "claims", "response", "reexamination", "invalidation"]).describe("文件类型"),
      },
      async execute(args, ctx) {
        const { action, document, document_type } = args

        ctx.metadata({
          title: `质量检查: ${action}`,
          metadata: { documentType: document_type },
        })

        // 尝试使用 YunPat EnhancedQualityCheckerAgent
        if (action === "quality") {
          try {
            const result = await runQualityCheck(document, document_type, pluginContext)
            if (result) return result
          } catch (error: any) {
            console.warn("[YunPat] QualityCheckerAgent error:", error?.message)
          }
        }

        // 增强：检索相关审查指南和质量标准
        let guidelinesData = ""
        try {
          const guidelines = await queryGuidelinesFromKB(
            action === "quality" ? "质量检查" :
            action === "subject_matter" ? "保护客体" :
            action === "unity" ? "单一性" :
            action === "formality" ? "形式审查" : "一致性"
          )
          if (guidelines && !guidelines.includes("未在审查指南中找到")) {
            guidelinesData = guidelines.slice(0, 2000)
          }
        } catch (error: any) {
          console.warn("[Check] Guidelines query error:", error?.message)
        }

        if (action === "quality") return await checkQuality(document, document_type, pluginContext, guidelinesData)
        if (action === "subject_matter") return await checkSubjectMatter(document, pluginContext, guidelinesData)
        if (action === "unity") return await checkUnity(document, pluginContext, guidelinesData)
        if (action === "formality") return await checkFormality(document, document_type, pluginContext)
        if (action === "consistency") return await checkConsistency(document, pluginContext, guidelinesData)

        return `未知的检查动作: ${action}`
      },
    }),
  }
}

async function runQualityCheck(
  document: string,
  docType: string,
  pluginContext: PatentPluginContext,
): Promise<string | null> {
  const mod = await loadYunPatModule("agents/quality")
  if (!mod?.EnhancedQualityCheckerAgent && !mod?.QualityCheckerAgent) return null

  const AgentClass = mod.EnhancedQualityCheckerAgent || mod.QualityCheckerAgent
  const context = await createAgentContext()
  if (!context) return null

  const agent = new AgentClass({
    llm: pluginContext.llm,
    eventBus: context.eventBus,
    memory: context.memory,
    tools: context.tools,
  })

  const result = await agent.run(
    {
      claims: { independentClaims: [document], dependentClaims: [] },
      specification: { technicalField: document, backgroundArt: "", summary: "", detailedDescription: "" },
      documentType: docType,
    },
    context,
  )

  if (!result.success) return null

  return `## 7 维度质量评估（YunPat Agent）✅\n\n${result.data?.report || result.data?.content || JSON.stringify(result.data, null, 2)}`
}

async function checkQuality(document: string, docType: string, pluginContext: PatentPluginContext, guidelines: string = "") {
  const prompt = `请对以下${docType}进行质量评估：

${document}

${guidelines ? `**审查指南参考**：\n${guidelines}\n\n` : ""}

请按以下维度评分（0-10分，≥7.5为合格）：

| 维度 | 权重 | 得分 | 说明 |
|------|------|------|------|
| completeness（完整性） | 15% | ? | 必要技术特征齐全 |
| clarity（清晰性） | 15% | ? | 无歧义用语 |
| accuracy（准确性） | 15% | ? | 技术描述准确 |
| sufficiency（充分性 A26.3） | 20% | ? | 公开充分 |
| consistency（一致性） | 10% | ? | 权利要求与说明书一致 |
| compliance（规范性） | 10% | ? | 格式符合要求 |
| support（支持性 A26.4） | 15% | ? | 权利要求有说明书支持 |

综合得分 = Σ(维度得分 × 权重)

如有不合格项（<7.5），请给出具体修改建议。`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利质量评估专家。使用 7 维度评估体系进行评分。参考审查指南的具体要求。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 7 维度质量评估\n\n${response.content}\n\n---\n\n> 注：完整质量检查需要接入 YunPat QualityCheckerAgent（@yunpat/agent-quality）的增强版评估逻辑。`
}

async function checkSubjectMatter(document: string, pluginContext: PatentPluginContext, guidelines: string = "") {
  const prompt = `请检查以下权利要求的客体适格性：

${document}

${guidelines ? `**审查指南参考**：\n${guidelines}\n\n` : ""}

请输出：
1. 每条权利要求的客体适格性（通过/不通过/需修改）
2. 法律依据（A2/A5/A25）
3. 修改建议（如不通过）`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是保护客体检查专家。依据专利法第2条、第5条、第25条判断客体适格性。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 保护客体适格性检查\n\n${response.content}\n\n---\n\n> 注：完整检查需要接入 YunPat SubjectMatterChecker（@yunpat/agent-subject-matter-checker）。`
}

async function checkUnity(document: string, pluginContext: PatentPluginContext, guidelines: string = "") {
  const prompt = `请检查以下权利要求的单一性：

${document}

${guidelines ? `**审查指南参考**：\n${guidelines}\n\n` : ""}

请输出：
1. 独立权利要求之间的单一性判断
2. 特定技术特征识别
3. 结论（符合/不符合单一性）`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是单一性检查专家。依据专利法第31条和审查指南判断单一性。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 单一性检查\n\n${response.content}`
}

async function checkFormality(document: string, docType: string, pluginContext: PatentPluginContext) {
  return `## 形式检查\n\n文件类型：${docType}\n\n检查项：\n- [ ] 格式符合国知局要求\n- [ ] 页码/段落编号正确\n- [ ] 附图标记一致\n- [ ] 引用文件格式正确\n\n> 注：完整形式检查需要接入 YunPat SpecFormalityChecker。`
}

async function checkConsistency(document: string, pluginContext: PatentPluginContext, guidelines: string = "") {
  const prompt = `请检查以下专利文件的一致性：

${document}

${guidelines ? `**审查指南参考**：\n${guidelines}\n\n` : ""}

请检查：
1. 权利要求中的每个特征是否在说明书中有支持
2. 术语使用是否一致
3. 附图标记是否一致
4. 技术方案描述是否一致`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利一致性检查专家。检查权利要求与说明书之间的一致性。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 一致性检查\n\n${response.content}`
}
