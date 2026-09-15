import type { ModelMessage } from "ai"
import { AUTO_VARIANT } from "@/provider/transform"

export type Effort = "low" | "medium" | "high" | "xhigh"

export const VARIANT = AUTO_VARIANT

const OVERRIDE = /^\s*\[(?:think|reasoning)\s*:\s*(low|medium|high|xhigh)\]/i

const COMPLEX_TERMS = [
  /\b(?:architect|debug|diagnos|implement|migrat|optim|refactor|security|concurren|race condition|root cause|proof|prove|theorem|derive|benchmark|regression|plugin|integration)\w*/gi,
  /(?:架构|调试|诊断|实现|迁移|优化|重构|安全|并发|竞态|根因|证明|定理|推导|基准|回归|插件|集成)/g,
]

const TASK_TERMS = [
  /\b(?:investigat|research|compar|review|updat|creat|build|fix|test|verif|analy|design|automatic)\w*/gi,
  /(?:调查|研究|比较|审查|检查|更新|创建|修复|测试|验证|分析|设计|尝试|功能|自动)/g,
]

const VERY_COMPLEX_TERMS = [
  /\b(?:formal proof|distributed system|cryptograph|deadlock|production incident|data loss|breaking change|cross-platform|end-to-end)\w*/gi,
  /(?:形式化证明|分布式系统|密码学|死锁|生产事故|数据丢失|破坏性变更|跨平台|端到端)/g,
]

const SIMPLE_TERMS = [
  /^\s*(?:what time|what date|translate|rename|format|summarize|explain briefly)\b/i,
  /^\s*(?:几点|日期|翻译|重命名|格式化|简要总结|简单解释)/,
]

const RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
}

const TARGET: Record<Effort, number> = { low: 2, medium: 3, high: 4, xhigh: 5 }

function matches(text: string, patterns: RegExp[]) {
  return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0)
}

function isEffort(value: string | undefined): value is Effort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}

export function classify(text: string, attachmentCount: number): Effort {
  const override = text.match(OVERRIDE)?.[1]?.toLowerCase()
  if (isEffort(override)) return override

  let score = 1
  const length = text.length
  if (length > 400) score += 1
  if (length > 1_200) score += 2
  if (length > 3_000) score += 2

  const codeBlocks = text.match(/```/g)?.length ?? 0
  score += Math.min(2, Math.floor(codeBlocks / 2))
  score += Math.min(3, attachmentCount * 2)
  score += Math.min(5, matches(text, COMPLEX_TERMS))
  score += Math.min(4, matches(text, TASK_TERMS) * 2)
  score += Math.min(4, matches(text, VERY_COMPLEX_TERMS) * 2)

  const requirementLines = text.match(/^\s*(?:[-*]|\d+[.)])\s+.+$/gm)?.length ?? 0
  if (requirementLines >= 2) score += 1
  if (requirementLines >= 5) score += 2

  if (length < 180 && SIMPLE_TERMS.some((pattern) => pattern.test(text))) score -= 2

  if (score >= 10) return "xhigh"
  if (score >= 6) return "high"
  if (score >= 3) return "medium"
  return "low"
}

export function promptText(messages: ModelMessage[]): { text: string; attachments: number } {
  const last = messages.findLast((message) => message.role === "user")
  if (!last) return { text: "", attachments: 0 }
  if (typeof last.content === "string") return { text: last.content, attachments: 0 }

  let text = ""
  let attachments = 0
  for (const part of last.content) {
    if (part.type === "text") text += part.text
    else if (part.type === "file" || part.type === "image") attachments++
  }
  return { text, attachments }
}

// Pick the available variant whose effort rank is closest to the classified
// effort, so models that only expose a subset (e.g. low/high) still resolve.
export function selectVariant(variants: Record<string, unknown>, effort: Effort): string | undefined {
  const candidates = Object.keys(variants)
    .filter((key) => key !== VARIANT && key !== "default" && RANK[key] !== undefined)
    .toSorted((a, b) => RANK[a] - RANK[b])
  if (candidates.length === 0) return undefined

  const target = TARGET[effort]
  return candidates.reduce((best, key) => (Math.abs(RANK[key] - target) < Math.abs(RANK[best] - target) ? key : best))
}

export function variantOptions(
  model: { variants?: Record<string, Record<string, unknown>> | undefined },
  effort: Effort,
) {
  if (!model.variants) return {}
  const selected = selectVariant(model.variants, effort)
  return selected ? model.variants[selected] : {}
}

export function autoVariant(
  model: { variants?: Record<string, Record<string, unknown>> | undefined },
  messages: ModelMessage[],
) {
  const prompt = promptText(messages)
  return variantOptions(model, classify(prompt.text, prompt.attachments))
}

export * as AutoReasoning from "./auto-reasoning"
