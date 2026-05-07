/**
 * Patent Research Tools
 *
 * 封装 YunPat 规则研究能力为 OpenCode Plugin Tools
 */

import { tool } from "@opencode-ai/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"

/**
 * 注册规则研究工具集
 */
export async function registerResearchTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利法规与实务研究
     */
    patent_research: tool({
      description: `
        研究知识产权法规与实务规则。当用户询问专利相关法规、审查指南、
        案例或实务操作时调用此工具。

        能力：
        - 检索法规条文、审查指南、审查操作规程
        - 归纳总结规则要点
        - 对比新旧规则差异
        - 引用典型案例和复审无效决定

        输入：研究主题、范围（法规/案例/实务/全部）、深度（概述/详细/深度）
        输出：结构化研究报告（Markdown），包含法规条文、案例摘要、操作要点、参考来源
      `,
      args: {
        topic: tool.schema.string().describe("研究主题，如'新用途专利创造性判定'"),
        scope: tool.schema.enum(["法规", "案例", "实务", "全部"]).optional().describe("研究范围"),
        depth: tool.schema.enum(["概述", "详细", "深度"]).optional().describe("研究深度"),
      },
      async execute(args, ctx) {
        const { topic, scope = "全部", depth = "详细" } = args

        try {
          // 尝试动态加载 YunPat ResearcherAgent
          const yunpat = await loadYunPatModule("agents/researcher")

          if (yunpat?.ResearcherAgent) {
            // 使用真实的 YunPat Agent
            const agent = new yunpat.ResearcherAgent({
              llm: pluginContext.llm,
              name: "ResearcherAgent",
              description: "知识产权法规研究专家",
            })

            const result = await agent.run({
              question: topic,
              depth: mapDepth(depth),
              sources: ["database"],
              maxResults: 10,
            })

            ctx.metadata({
              title: `规则研究: ${topic}`,
              metadata: { scope, depth, sources: result.data?.sources?.length ?? 0 },
            })

            return formatResearchResult(result.data)
          }
        } catch (error) {
          console.warn("[YunPat] ResearcherAgent not available, falling back to LLM:", error)
        }

        // 降级：直接调用 LLM 进行知识研究
        const prompt = buildResearchPrompt(topic, scope, depth)
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是知识产权法规研究专家，熟悉中国专利法及实施细则、审查指南、复审无效案例。" },
            { role: "user", content: prompt },
          ],
        })

        ctx.metadata({
          title: `规则研究: ${topic}`,
          metadata: { scope, depth, sources: [], mode: "llm-fallback" },
        })

        return response.content
      },
    }),

    /**
     * 法规条文查询
     */
    patent_law_query: tool({
      description: `
        查询具体的专利法规条文。当用户询问某个法条的具体内容时调用。
        如"专利法第22条第三款是什么"
      `,
      args: {
        law: tool.schema.string().describe("法规名称，如'专利法'、'实施细则'、'审查指南'"),
        article: tool.schema.string().describe("条款号，如'第22条'"),
        paragraph: tool.schema.string().optional().describe("款项，如'第一款'"),
      },
      async execute(args, _ctx) {
        const { law, article, paragraph } = args

        // TODO: 查询 YunPat 知识库
        return `【${law}${article}${paragraph ?? ""}】\n\n> 注：此功能需要接入 YunPat 知识库（knowledge-base/ 4,385 文件）才能提供准确条文。`
      },
    }),
  }
}

/**
 * 映射深度参数
 */
function mapDepth(depth: string): "quick" | "standard" | "comprehensive" {
  const map: Record<string, "quick" | "standard" | "comprehensive"> = {
    "概述": "quick",
    "详细": "standard",
    "深度": "comprehensive",
  }
  return map[depth] ?? "standard"
}

/**
 * 格式化研究结果
 */
function formatResearchResult(data: any): string {
  if (!data) return "研究完成，但未返回有效数据。"

  const result = data as any
  let output = "## 研究报告\n\n"

  if (result.summary) {
    output += `### 摘要\n${result.summary}\n\n`
  }

  if (result.keyFindings?.length) {
    output += "### 核心发现\n"
    result.keyFindings.forEach((f: string, i: number) => {
      output += `${i + 1}. ${f}\n`
    })
    output += "\n"
  }

  if (result.sources?.length) {
    output += "### 参考来源\n"
    result.sources.forEach((s: any, i: number) => {
      output += `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n`
    })
    output += "\n"
  }

  return output
}

/**
 * 构建研究提示词
 */
function buildResearchPrompt(topic: string, scope: string, depth: string): string {
  return `请对以下知识产权主题进行深入研究：

**研究主题**：${topic}
**研究范围**：${scope}
**研究深度**：${depth}

请按以下结构输出研究报告：

## 一、背景概述
简要说明该主题在专利实务中的背景和重要性。

## 二、相关法规条文
列出与该主题直接相关的专利法、实施细则、审查指南条文，并标注具体条款号。

## 三、典型案例/决定
引用 2-3 个相关复审无效决定或法院判例，标注案号。

## 四、实务操作要点
总结专利代理人在实务中处理该主题时的关键要点和注意事项。

## 五、参考来源
列出所有引用的法规、案例、指南来源。

注意：
- 所有法规引用必须标注具体条款号
- 所有案例引用必须标注案号
- 不允许无出处的断言
- 如信息不确定，明确标注"待核实"`
}
