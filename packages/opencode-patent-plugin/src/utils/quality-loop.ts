/**
 * 质量迭代闭环引擎
 *
 * 实现宪法第 10.2 条的 7 维度质量评估 + 自动迭代修复：
 * - 7 维度评分（completeness/clarity/accuracy/sufficiency/consistency/compliance/support）
 * - 得分 < 7.5 自动识别问题并修复
 * - 最多 3 轮迭代，超出转人工
 * - 加权综合得分计算
 */

import type { OpenCodeLLMAdapter } from "../adapters/llm.js"

/**
 * 维度定义（与宪法第 10.2 条一致）
 */
export const QUALITY_DIMENSIONS = {
  completeness: { label: "完整性", weight: 0.15, desc: "必要技术特征齐全" },
  clarity:      { label: "清晰性", weight: 0.15, desc: "无歧义用语" },
  accuracy:     { label: "准确性", weight: 0.15, desc: "技术描述准确" },
  sufficiency:  { label: "充分性(A26.3)", weight: 0.20, desc: "公开充分" },
  consistency:  { label: "一致性", weight: 0.10, desc: "权利要求与说明书一致" },
  compliance:   { label: "规范性", weight: 0.10, desc: "格式符合要求" },
  support:      { label: "支持性(A26.4)", weight: 0.15, desc: "权利要求有说明书支持" },
} as const

export type DimensionKey = keyof typeof QUALITY_DIMENSIONS

/** 单维度评分 */
export interface DimensionScore {
  key: DimensionKey
  label: string
  score: number       // 0-10
  passed: boolean     // >= 7.5
  issues: string[]    // 具体问题描述
}

/** 质量报告 */
export interface QualityReport {
  /** 各维度评分 */
  dimensions: DimensionScore[]
  /** 加权综合得分 */
  overallScore: number
  /** 是否全部通过 */
  passed: boolean
  /** 未通过的维度 */
  failedDimensions: DimensionKey[]
  /** 修复建议 */
  fixSuggestions: string[]
  /** 迭代次数 */
  iterations: number
  /** 最终文档 */
  finalDocument: string
  /** 迭代历史 */
  history: Array<{
    iteration: number
    overallScore: number
    failedDimensions: DimensionKey[]
  }>
}

/** 质量评估请求 */
export interface QualityLoopOptions {
  /** 文档类型 */
  documentType: "specification" | "claims" | "response" | "reexamination" | "invalidation"
  /** 最大迭代次数（默认 3） */
  maxIterations?: number
  /** 通过阈值（默认 7.5） */
  threshold?: number
  /** 上下文信息（如原始交底书、对比文件等，帮助更准确评估） */
  context?: string
}

const THRESHOLD = 7.5
const MAX_ITERATIONS = 3

/**
 * 解析 LLM 返回的 JSON 评分
 */
function parseQualityResponse(text: string): {
  dimensions: DimensionScore[]
  suggestions: string[]
} {
  // 尝试从 LLM 输出中提取 JSON
  let jsonStr = text

  // 提取 ```json ... ``` 块
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1]
  }

  // 尝试提取 { ... } 块
  if (!jsonStr.startsWith("{")) {
    const braceMatch = text.match(/\{[\s\S]*\}/)
    if (braceMatch) {
      jsonStr = braceMatch[0]
    }
  }

  try {
    const parsed = JSON.parse(jsonStr)

    const dimensions: DimensionScore[] = Object.entries(QUALITY_DIMENSIONS).map(([key, def]) => {
      const dimData = parsed.dimensions?.[key] ?? parsed[key]
      const score = typeof dimData === "number" ? dimData : (dimData?.score ?? 0)
      return {
        key: key as DimensionKey,
        label: def.label,
        score: Math.min(10, Math.max(0, score)),
        passed: score >= THRESHOLD,
        issues: Array.isArray(dimData?.issues) ? dimData.issues : [],
      }
    })

    const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : []

    return { dimensions, suggestions }
  } catch (parseError: any) {
    // JSON 解析失败 → 抛出错误，中断无意义的修复循环
    throw new Error(
      `Quality evaluation response parse failed: ${parseError?.message}. ` +
      `LLM output was not valid JSON. Raw output (first 500 chars): ${text.slice(0, 500)}`,
    )
  }
}

/**
 * 计算加权综合得分
 */
function calculateOverallScore(dimensions: DimensionScore[]): number {
  let totalWeight = 0
  let weightedSum = 0
  for (const dim of dimensions) {
    const weight = QUALITY_DIMENSIONS[dim.key].weight
    weightedSum += dim.score * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * 运行一次质量评估
 */
export async function evaluateQuality(
  document: string,
  documentType: string,
  llm: OpenCodeLLMAdapter,
  context?: string,
): Promise<{ dimensions: DimensionScore[]; suggestions: string[] }> {
  const dimensionList = Object.entries(QUALITY_DIMENSIONS)
    .map(([key, def]) => `- ${key}(${def.label}): ${def.desc}`)
    .join("\n")

  const prompt = `请对以下${documentType}进行严格的质量评估。

${context ? `**参考上下文**：\n${context.slice(0, 2000)}\n\n` : ""}

**待评估文档**：
${document}

请按以下 7 个维度逐一评分（0-10分），并指出具体问题：

${dimensionList}

**请严格按以下 JSON 格式返回（不要输出其他内容）**：

\`\`\`json
{
  "dimensions": {
    "completeness": { "score": 8, "issues": ["问题描述（如无问题留空数组）"] },
    "clarity": { "score": 7, "issues": [] },
    "accuracy": { "score": 9, "issues": [] },
    "sufficiency": { "score": 6.5, "issues": ["具体实施方式缺少X方面的描述"] },
    "consistency": { "score": 8, "issues": [] },
    "compliance": { "score": 7, "issues": [] },
    "support": { "score": 8, "issues": [] }
  },
  "suggestions": ["针对不合格维度的具体修改建议"]
}
\`\`\`

评分标准：≥7.5 为合格，<7.5 需要修复。请严格依据中国专利法第26条和审查指南要求评分。`

  const response = await llm.chat({
    messages: [
      { role: "system", content: "你是专利质量评估专家。严格依据中国专利法和审查指南进行评分。只返回 JSON，不要输出其他内容。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  })

  return parseQualityResponse(response.content)
}

/**
 * 自动修复质量缺陷
 */
async function fixQualityIssues(
  document: string,
  documentType: string,
  failedDimensions: DimensionScore[],
  suggestions: string[],
  llm: OpenCodeLLMAdapter,
  context?: string,
): Promise<string> {
  const failedDesc = failedDimensions
    .map(d => `**${d.label}**（得分: ${d.score}）：\n  ${d.issues.join("\n  ")}`)
    .join("\n\n")

  const prompt = `请修复以下${documentType}的质量缺陷。

${context ? `**参考上下文**：\n${context.slice(0, 2000)}\n\n` : ""}

**原文档**：
${document}

**需要修复的维度**：
${failedDesc}

**修复建议**：
${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

**要求**：
1. 针对每个不合格维度的具体问题逐一修复
2. 保持原文档的整体结构和已合格部分不变
3. 修复后的文档应符合审查指南格式要求
4. 输出完整的修复后文档（不要省略任何部分）`

  const response = await llm.chat({
    messages: [
      { role: "system", content: "你是专利文件修复专家。严格依据审查指南修复质量缺陷。只输出修复后的完整文档。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 8192,
  })

  return response.content
}

/**
 * 质量迭代闭环
 *
 * 流程：评估 → 检查 → 修复 → 重新评估，最多 maxIterations 轮评估。
 * 默认 maxIterations=3，即最多 3 次评估、2 次修复。
 *
 * @returns QualityReport 包含最终评分、迭代历史和修复后的文档
 */
export async function qualityLoop(
  document: string,
  options: QualityLoopOptions,
  llm: OpenCodeLLMAdapter,
): Promise<QualityReport> {
  const {
    documentType,
    maxIterations = MAX_ITERATIONS,
    threshold = THRESHOLD,
    context,
  } = options

  if (!document || document.trim().length === 0) {
    throw new Error("qualityLoop: document cannot be empty")
  }

  const history: QualityReport["history"] = []
  let currentDocument = document
  let iterations = 0

  for (let round = 0; round < maxIterations; round++) {
    iterations = round

    // 评估
    const { dimensions, suggestions } = await evaluateQuality(
      currentDocument,
      documentType,
      llm,
      context,
    )

    const overallScore = calculateOverallScore(dimensions)
    const failedDimensions = dimensions.filter(d => d.score < threshold)
    const failedKeys = failedDimensions.map(d => d.key)

    history.push({
      iteration: round,
      overallScore: Math.round(overallScore * 100) / 100,
      failedDimensions: failedKeys,
    })

    // 全部通过
    if (failedDimensions.length === 0) {
      return {
        dimensions,
        overallScore: Math.round(overallScore * 100) / 100,
        passed: true,
        failedDimensions: [],
        fixSuggestions: [],
        iterations,
        finalDocument: currentDocument,
        history,
      }
    }

    // 最后一轮只评估不修复，返回结果转人工
    if (round === maxIterations - 1) {
      return {
        dimensions,
        overallScore: Math.round(overallScore * 100) / 100,
        passed: false,
        failedDimensions: failedKeys,
        fixSuggestions: suggestions,
        iterations,
        finalDocument: currentDocument,
        history,
      }
    }

    // 自动修复
    console.log(
      `[QualityLoop] Round ${round + 1}: score=${overallScore.toFixed(1)}, ` +
      `failed=[${failedKeys.join(",")}], fixing...`,
    )

    try {
      currentDocument = await fixQualityIssues(
        currentDocument,
        documentType,
        failedDimensions,
        suggestions,
        llm,
        context,
      )
    } catch (error: any) {
      console.error(`[QualityLoop] Fix failed at round ${round + 1}:`, error?.message)
      // 修复失败，返回当前结果转人工
      return {
        dimensions,
        overallScore: Math.round(overallScore * 100) / 100,
        passed: false,
        failedDimensions: failedKeys,
        fixSuggestions: [...suggestions, `自动修复失败: ${error?.message}`],
        iterations: round,
        finalDocument: currentDocument,
        history,
      }
    }
  }

  // 不应该到达这里，但以防万一
  const { dimensions: finalDims } = await evaluateQuality(currentDocument, documentType, llm, context)
  return {
    dimensions: finalDims,
    overallScore: Math.round(calculateOverallScore(finalDims) * 100) / 100,
    passed: false,
    failedDimensions: finalDims.filter(d => d.score < threshold).map(d => d.key),
    fixSuggestions: ["超过最大迭代次数"],
    iterations,
    finalDocument: currentDocument,
    history,
  }
}

/**
 * 格式化质量报告为 Markdown
 */
export function formatQualityReport(report: QualityReport): string {
  const dimTable = report.dimensions
    .map(d => {
      const status = d.passed ? "✅" : "❌"
      const weight = (QUALITY_DIMENSIONS[d.key].weight * 100).toFixed(0)
      return `| ${status} ${d.label} | ${weight}% | ${d.score.toFixed(1)} | ${d.issues.join("; ") || "—" } |`
    })
    .join("\n")

  let output = `## 7 维度质量评估报告\n\n`
  output += `**综合得分**：${report.overallScore.toFixed(1)} / 10  ${report.passed ? "✅ 通过" : "❌ 需人工审核"}\n`
  output += `**迭代次数**：${report.iterations}\n\n`
  output += `| 维度 | 权重 | 得分 | 问题 |\n`
  output += `|------|------|------|------|\n`
  output += `${dimTable}\n\n`

  if (report.history.length > 1) {
    output += `### 迭代历史\n\n`
    for (const h of report.history) {
      output += `- **第 ${h.iteration + 1} 轮**：综合得分 ${h.overallScore.toFixed(1)}`
      if (h.failedDimensions.length > 0) {
        output += `，未通过: ${h.failedDimensions.join(", ")}`
      } else {
        output += `，全部通过 ✅`
      }
      output += `\n`
    }
    output += `\n`
  }

  if (!report.passed && report.fixSuggestions.length > 0) {
    output += `### 人工审核建议\n\n`
    report.fixSuggestions.forEach((s, i) => {
      output += `${i + 1}. ${s}\n`
    })
    output += `\n`
  }

  return output
}
