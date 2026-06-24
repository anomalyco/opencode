import { detectAndVerify } from "./math-parser"

export interface CotResult {
  action: "pass" | "block"
  reason?: string
  stepNumber?: number
}

export interface CotSummary {
  sentencesChecked: number
  violations: number
  variablesTracked: number
}

const VAR_ASSIGN_RE = /(?:misalkan|anggap|nilai|dengan|dimana)\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?)/i
const STANDALONE_VAR_RE = /^(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/

export class CotVerifier {
  private buffer = ""
  private vars = new Map<string, number>()
  private stepCount = 0
  private lastProcessedPos = 0
  private sentencesChecked = 0
  private violations = 0

  feed(chunk: string): CotResult {
    const hasSentenceEnd = /[.!?\n]/.test(chunk)
    if (!hasSentenceEnd) {
      this.buffer += chunk
      return { action: "pass" }
    }

    this.buffer += chunk
    const pending = this.buffer.slice(this.lastProcessedPos)
    const sentences = pending.split(/(?<=[.!?\n])\s*/)
    const lastIsComplete = pending.length > 0 && /[.!?\n]$/.test(pending)

    const completeSentences = lastIsComplete ? sentences : sentences.slice(0, -1)
    for (const raw of completeSentences) {
      const trimmed = raw.trim()
      if (trimmed.length < 3) continue

      this.sentencesChecked++

      const assignMatch = trimmed.match(VAR_ASSIGN_RE)
      if (assignMatch) {
        const varName = assignMatch[1]
        const varValue = parseFloat(assignMatch[2])
        if (!isNaN(varValue)) {
          this.vars.set(varName, varValue)
        }
      }

      const standaloneMatch = trimmed.match(STANDALONE_VAR_RE)
      if (standaloneMatch && !trimmed.includes("+") && !trimmed.includes("*") && !trimmed.includes("/") && !trimmed.includes("%")) {
        const varName = standaloneMatch[1]
        const varValue = parseFloat(standaloneMatch[2])
        if (!isNaN(varValue)) {
          this.vars.set(varName, varValue)
        }
      }

      if (trimmed.match(/[+\-*\/%()=]/)) {
        const substituted = this.substituteVariables(trimmed)
        const mathResult = detectAndVerify(substituted)
        if (mathResult) {
          this.violations++
          const stepRef = this.stepCount > 0 ? ` (langkah ${this.stepCount})` : ""
          return {
            action: "block",
            reason: `CoT: ${mathResult.expression} ≠ ${mathResult.claimedResult}${stepRef}`,
            stepNumber: this.stepCount || undefined,
          }
        }
      }

      if (/^langkah\s+\d+/i.test(trimmed)) this.stepCount++
    }

    if (lastIsComplete) {
      this.lastProcessedPos = this.buffer.length
    } else {
      this.lastProcessedPos = this.buffer.length - (sentences.at(-1)?.length ?? 0)
    }

    return { action: "pass" }
  }

  private substituteVariables(text: string): string {
    let result = text
    for (const [name, value] of this.vars) {
      result = result.replace(new RegExp(`\\b${name}\\b`, "g"), String(value))
    }
    return result
  }

  verifyFullText(fullText: string): CotSummary {
    this.sentencesChecked = 0
    this.violations = 0
    this.buffer = fullText
    this.lastProcessedPos = 0
    this.vars.clear()

    const sentences = fullText.split(/(?<=[.!?\n])\s*/)
    for (const raw of sentences) {
      const trimmed = raw.trim()
      if (trimmed.length < 3) continue
      this.sentencesChecked++

      const assignMatch = trimmed.match(VAR_ASSIGN_RE)
      if (assignMatch) {
        const varValue = parseFloat(assignMatch[2])
        if (!isNaN(varValue)) this.vars.set(assignMatch[1], varValue)
      }

      const standaloneMatch = trimmed.match(STANDALONE_VAR_RE)
      if (standaloneMatch && !trimmed.includes("+") && !trimmed.includes("*") && !trimmed.includes("/") && !trimmed.includes("%")) {
        const varValue = parseFloat(standaloneMatch[2])
        if (!isNaN(varValue)) this.vars.set(standaloneMatch[1], varValue)
      }

      if (trimmed.match(/[+\-*\/%()=]/)) {
        const substituted = this.substituteVariables(trimmed)
        if (detectAndVerify(substituted)) this.violations++
      }
    }

    return {
      sentencesChecked: this.sentencesChecked,
      violations: this.violations,
      variablesTracked: this.vars.size,
    }
  }

  reset(): void {
    this.buffer = ""
    this.vars.clear()
    this.stepCount = 0
    this.lastProcessedPos = 0
    this.sentencesChecked = 0
    this.violations = 0
  }

  getVariables(): ReadonlyMap<string, number> {
    return this.vars
  }
}
