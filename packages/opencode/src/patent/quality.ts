import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"

const DIMENSIONS = [
  { key: "completeness", name: "完整性", weight: 0.15 },
  { key: "clarity", name: "清晰性", weight: 0.15 },
  { key: "accuracy", name: "准确性", weight: 0.15 },
  { key: "sufficiency", name: "充分性(A26.3)", weight: 0.20 },
  { key: "consistency", name: "一致性", weight: 0.10 },
  { key: "compliance", name: "规范性", weight: 0.10 },
  { key: "support", name: "支持性(A26.4)", weight: 0.15 },
] as const

export interface QualityCheckInput {
  document_type: "specification" | "claims" | "oa_response" | "full"
  content: string
  context?: string
}

export interface DimensionScore {
  key: string
  name: string
  score: number
  weight: number
  issues: string[]
}

export interface QualityReport {
  scores: DimensionScore[]
  totalScore: number
  passed: boolean
  summary: string
  suggestions: string[]
}

export interface Interface {
  readonly check: (input: QualityCheckInput) => Effect.Effect<QualityReport>
  readonly autoFix: (input: QualityCheckInput, report: QualityReport) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentQuality") {}

const calculateDimensionScore = (content: string, dimension: typeof DIMENSIONS[number]): DimensionScore => {
  const lines = content.split("\n").length
  const length = content.length
  const issues: string[] = []

  let score = 7.0

  if (lines < 10 && dimension.key !== "consistency") {
    score -= 2
    issues.push(`${dimension.name}：内容过短，可能缺乏细节`)
  }

  if (length < 100 && dimension.key !== "consistency") {
    score -= 1
    issues.push(`${dimension.name}：字数不足`)
  }

  if (dimension.key === "completeness" && !content.includes("技术领域") && !content.includes("背景技术")) {
    score -= 2
    issues.push(`${dimension.name}：缺少技术领域或背景技术部分`)
  }

  if (dimension.key === "clarity" && content.includes("等等") && content.split("等等").length > 3) {
    score -= 1
    issues.push(`${dimension.name}：过多使用"等等"，表述不明确`)
  }

  if (dimension.key === "accuracy" && /\d+[%％]/.test(content) === false) {
    score -= 1
    issues.push(`${dimension.name}：缺少具体数值或百分比`)
  }

  if (dimension.key === "sufficiency" && content.length < 500) {
    score -= 2
    issues.push(`${dimension.name}：描述不够充分，本领域技术人员难以实现`)
  }

  if (dimension.key === "consistency") {
    const claimPattern = /权利要求|权项|claim/i
    const descPattern = /说明书|描述|description/i
    const hasClaim = claimPattern.test(content)
    const hasDesc = descPattern.test(content)
    if (hasClaim && !hasDesc) {
      score -= 2
      issues.push(`${dimension.name}：权利要求与说明书不一致`)
    }
  }

  if (dimension.key === "compliance" && !/[（(]\d[)）]/.test(content)) {
    score -= 1
    issues.push(`${dimension.name}：缺少引用标记`)
  }

  if (dimension.key === "support" && content.includes("优选")) {
    const preferredCount = (content.match(/优选/g) || []).length
    if (preferredCount > 10) {
      score -= 1
      issues.push(`${dimension.name}：优选实施例过多，可能不支持权利要求`)
    }
  }

  score = Math.max(0, Math.min(10, score))

  return {
    key: dimension.key,
    name: dimension.name,
    score,
    weight: dimension.weight,
    issues,
  }
}

const calculateTotalScore = (scores: DimensionScore[]): number => {
  const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0)
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0)
  return Number((weightedSum / totalWeight).toFixed(2))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const check = Effect.fn("PatentQuality.check")(function* (input: QualityCheckInput) {
      const cfg = yield* config.get()
      const threshold = cfg.patent?.quality?.threshold ?? 6.0

      const scores = DIMENSIONS.map((dim) => calculateDimensionScore(input.content, dim))

      const totalScore = calculateTotalScore(scores)
      const allIssues = scores.flatMap((s) => s.issues)
      const passed = totalScore >= threshold

      const summary = allIssues.length > 0
        ? `检测到 ${allIssues.length} 个质量问题，总分 ${totalScore}`
        : `质量良好，总分 ${totalScore}`

      const suggestions = allIssues.slice(0, 5)

      return { scores, totalScore, passed, summary, suggestions } satisfies QualityReport
    })

    const autoFix = Effect.fn("PatentQuality.autoFix")(function* (
      input: QualityCheckInput,
      report: QualityReport,
    ) {
      const cfg = yield* config.get()
      const maxIterations = cfg.patent?.quality?.maxIterations ?? 3

      if (!report.passed && report.suggestions.length > 0) {
        const fixesHeader = `
---
自动修复建议（最多 ${maxIterations} 次迭代）：
${report.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}
---
`
        return `${fixesHeader}\n\n${input.content}`
      }

      return input.content
    })

    return Service.of({ check, autoFix })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as PatentQuality from "./quality"