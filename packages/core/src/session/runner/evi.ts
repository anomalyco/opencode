export * as EVI from "./evi"

import { ReflectionState } from "./reflection-state"

export interface EVIScore {
  readonly toolName: string
  readonly score: number
  readonly entropyReduction: number
  readonly cost: number
  readonly risk: number
  readonly isDiagnostic: boolean
  readonly rationale: string
}

const DIAGNOSTIC_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "list",
  "webfetch",
  "websearch",
])

const MUTATIVE_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
])

export function entropy(probabilities: ReadonlyArray<number>): number {
  const valid = probabilities.filter((p) => p > 0 && p <= 1)
  const sum = valid.reduce((a, b) => a + b, 0)
  if (sum === 0) return 0
  const normalized = valid.map((p) => p / sum)
  const val = -normalized.reduce((acc, p) => acc + (p > 0 ? p * Math.log2(p) : 0), 0)
  return Math.abs(val) < 1e-9 ? 0 : val
}

export function estimateDiagnosticity(toolName: string, commandInput?: string): number {
  if (DIAGNOSTIC_TOOLS.has(toolName)) return 0.85
  if (toolName === "bash") {
    const cmd = commandInput?.toLowerCase() ?? ""
    const isTestOrInspect = /\b(test|check|verify|status|diff|grep|find|cat|ls|node -e|bun -e|bun test)\b/.test(cmd)
    if (isTestOrInspect) return 0.75
    const isDestructive = /\b(rm|mv|sed -i|git reset|git checkout --)\b/.test(cmd)
    if (isDestructive) return 0.1
    return 0.4
  }
  if (MUTATIVE_TOOLS.has(toolName)) return 0.15
  return 0.3
}

export function estimateCost(toolName: string): number {
  const costMap: Record<string, number> = {
    read: 0.1,
    grep: 0.15,
    glob: 0.1,
    list: 0.1,
    edit: 0.2,
    write: 0.2,
    apply_patch: 0.2,
    bash: 0.35,
    websearch: 0.3,
    webfetch: 0.3,
    task: 0.5,
  }
  return costMap[toolName] ?? 0.25
}

export function estimateRisk(toolName: string, recentFailures = 0): number {
  const baseRisk = MUTATIVE_TOOLS.has(toolName) ? 0.4 : toolName === "bash" ? 0.3 : 0.05
  return Math.min(1, baseRisk + recentFailures * 0.1)
}

export function scoreToolEVI(
  toolName: string,
  hypotheses: ReadonlyArray<Pick<ReflectionState.Hypothesis, "description" | "probability">>,
  options?: { commandInput?: string; recentFailures?: number },
): EVIScore {
  const probs = hypotheses.map((h) => h.probability)
  const priorEntropy = entropy(probs)
  const diagnosticity = estimateDiagnosticity(toolName, options?.commandInput)
  const entropyReduction = priorEntropy * diagnosticity
  const cost = estimateCost(toolName)
  const risk = estimateRisk(toolName, options?.recentFailures)

  const score = (entropyReduction * 1.5 + diagnosticity * 0.5) / (cost + risk + 0.1)

  let rationale = ""
  if (diagnosticity >= 0.7) {
    rationale = `High diagnostic power (expected entropy reduction: ${entropyReduction.toFixed(2)} bits)`
  } else if (MUTATIVE_TOOLS.has(toolName)) {
    rationale = `Mutative action; low information gain (${entropyReduction.toFixed(2)} bits), elevated risk`
  } else {
    rationale = `Moderate expected value (${score.toFixed(2)})`
  }

  return {
    toolName,
    score,
    entropyReduction,
    cost,
    risk,
    isDiagnostic: diagnosticity >= 0.6,
    rationale,
  }
}

export function rankToolsByEVI(
  toolNames: ReadonlyArray<string>,
  hypotheses: ReadonlyArray<Pick<ReflectionState.Hypothesis, "description" | "probability">>,
): ReadonlyArray<EVIScore> {
  return toolNames
    .map((name) => scoreToolEVI(name, hypotheses))
    .sort((a, b) => b.score - a.score)
}

export function guidanceTextForEVI(
  hypotheses: ReadonlyArray<Pick<ReflectionState.Hypothesis, "description" | "probability">>,
): string | undefined {
  if (hypotheses.length <= 1) return undefined
  const probs = hypotheses.map((h) => h.probability)
  const currentEntropy = entropy(probs)
  if (currentEntropy < 0.4) return undefined

  const sorted = [...hypotheses].sort((a, b) => b.probability - a.probability)
  const topList = sorted.map((h) => `[${Math.round(h.probability * 100)}%] ${h.description}`).join("; ")

  return [
    `[Expected Value of Information (EVI)] Uncertainty entropy is ${currentEntropy.toFixed(2)} bits across competing hypotheses:`,
    topList,
    `Prioritize high-EVI diagnostic actions (read, grep, verify) over speculative modifications until hypotheses resolve.`,
  ].join("\n")
}