/**
 * Task Complexity Detection
 *
 * Estimates task complexity to decide orchestration strategy.
 * Uses a hybrid approach combining:
 * - Programmatic signal detection (word boundaries)
 * - Question detection (to reduce false positives)
 * - Weighted scoring (strong vs weak signals)
 *
 * Inspired by OpenCode's phase-based approach combined with
 * programmatic detection from our Python implementation.
 *
 * Ported from: scripts/cli_context_inject.py
 */

import { Log } from "../util/log"

const log = Log.create({ service: "complexity" })

export namespace Complexity {
  /**
   * Complexity levels that determine orchestration behavior
   */
  export type Level = "simple" | "moderate" | "complex" | "research"

  /**
   * Result of complexity estimation
   */
  export interface EstimateResult {
    level: Level
    score: number
    signals: string[]
    isQuestion: boolean
  }

  /**
   * Check if signal matches with word boundaries
   */
  function wordBoundaryMatch(signal: string, text: string): boolean {
    const pattern = new RegExp(`\\b${signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    return pattern.test(text)
  }

  /**
   * Detect if prompt is a simple question that shouldn't trigger orchestration
   */
  function isSimpleQuestion(prompt: string): boolean {
    const lower = prompt.toLowerCase().trim()

    // Simple question starters
    const questionStarters = [
      "is ",
      "are ",
      "does ",
      "do ",
      "can ",
      "could ",
      "would ",
      "what is ",
      "what are ",
      "where is ",
      "where are ",
      "how is ",
      "why is ",
      "when is ",
      "which ",
      "tell me about ",
      "explain ",
    ]

    // Check if it starts with a question word
    if (questionStarters.some((q) => lower.startsWith(q))) {
      // But not if it's asking to DO something
      const actionInQuestion = [
        "how do i ",
        "how can i ",
        "how should i ",
        "can you ",
        "could you ",
        "would you ",
      ]
      if (!actionInQuestion.some((a) => lower.startsWith(a))) {
        return true
      }
    }

    // Check for question mark at end with short length
    if (prompt.trim().endsWith("?") && prompt.split(/\s+/).length < 15) {
      return true
    }

    return false
  }

  /**
   * Estimate task complexity with detailed scoring
   */
  export function estimate(prompt: string): EstimateResult {
    const lower = prompt.toLowerCase()
    const signals: string[] = []
    let score = 0

    // Simple questions don't need orchestration
    const isQuestion = isSimpleQuestion(prompt)
    if (isQuestion) {
      return {
        level: "simple",
        score: 0,
        signals: ["simple_question"],
        isQuestion: true,
      }
    }

    // Research indicators (strong signals)
    const researchSignals = [
      "research",
      "investigate",
      "analyze",
      "explore",
      "comprehensive",
      "deep dive",
      "survey",
      "audit",
    ]
    const researchBoundarySignals = ["review", "understand"]

    for (const s of researchSignals) {
      if (lower.includes(s)) {
        score += 2
        signals.push(`research:${s}`)
      }
    }

    for (const s of researchBoundarySignals) {
      if (wordBoundaryMatch(s, lower)) {
        score += 1.5
        signals.push(`research_boundary:${s}`)
      }
    }

    if (score >= 1.5) {
      return {
        level: "research",
        score,
        signals,
        isQuestion: false,
      }
    }

    // Complex task indicators
    const strongComplexSignals = [
      "implement",
      "refactor",
      "migrate",
      "integrate",
      "create a system",
      "architect",
      "redesign",
    ]
    const weakComplexSignals = [
      "build",
      "design",
      "multiple",
      "entire",
      "comprehensive",
      "parallel",
      "background",
    ]
    const veryWeakSignals = ["all", "complete", "full", "across", "everything"]

    for (const s of strongComplexSignals) {
      if (lower.includes(s)) {
        score += 1.5
        signals.push(`strong:${s}`)
      }
    }

    for (const s of weakComplexSignals) {
      if (wordBoundaryMatch(s, lower)) {
        score += 0.7
        signals.push(`weak:${s}`)
      }
    }

    for (const s of veryWeakSignals) {
      if (wordBoundaryMatch(s, lower)) {
        score += 0.3
        signals.push(`very_weak:${s}`)
      }
    }

    // Multi-step indicators
    const multistepSignals = [" then ", "first,", "after that", "finally,", "step ", "phase "]
    const listIndicators = ["1.", "2.", "- "]

    for (const s of multistepSignals) {
      if (lower.includes(s)) {
        score += 0.8
        signals.push(`multistep:${s.trim()}`)
      }
    }

    for (const s of listIndicators) {
      if (prompt.includes(s)) {
        score += 0.4
        signals.push(`list:${s}`)
      }
    }

    // Length as complexity proxy (but less weight)
    const wordCount = prompt.split(/\s+/).length
    if (wordCount > 60) {
      score += 0.5
      signals.push(`long:${wordCount}`)
    }

    // Determine level from score
    let level: Level
    if (score >= 1.5) {
      level = "complex"
    } else if (score >= 0.7) {
      level = "moderate"
    } else {
      level = "simple"
    }

    log.debug("Complexity estimated", { level, score, signals: signals.length })

    return {
      level,
      score,
      signals,
      isQuestion: false,
    }
  }

  /**
   * Quick check if prompt should trigger orchestration awareness
   */
  export function shouldInjectOrchestration(prompt: string): boolean {
    const result = estimate(prompt)
    return result.level === "complex" || result.level === "research"
  }

  /**
   * Get recommended parallelism level based on complexity
   *
   * Based on OpenCode's phase-based approach:
   * - Low: 1 agent (single file, isolated task)
   * - Medium: 2 agents (2-5 files)
   * - High: 3 agents (5+ files or uncertain scope)
   */
  export function recommendedParallelism(level: Level): number {
    switch (level) {
      case "simple":
        return 1
      case "moderate":
        return 2
      case "complex":
      case "research":
        return 3
      default:
        return 1
    }
  }
}
