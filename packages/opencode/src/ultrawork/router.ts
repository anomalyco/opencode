/**
 * ULTRAWORK Router - Intelligent Task Routing
 *
 * Routes each task to the AI that's BEST at handling it.
 * Uses capability matching, cost optimization, and historical
 * performance data to make routing decisions.
 *
 * Inspired by:
 * - AgenticSeek's smart agent selection
 * - Roo Code's mode-switching architecture
 * - EvoAgentX's self-evolving routing
 *
 * Routing strategy:
 * - Architecture/Orchestration -> Claude Opus 4.5
 * - Code generation/API work   -> ChatGPT Codex / Claude
 * - Research/Multimodal        -> Gemini Pro Ultra
 * - Real-time data/Social      -> Grok
 * - Math/Algorithms            -> DeepSeek
 * - i18n/Multilingual          -> Qwen
 * - Privacy-sensitive/Offline  -> Local GPU (5090)
 */

import { Log } from "../util/log"
import { UltraworkFederation, type AICapability, type FederationMember } from "./federation"
import { UltraworkMemory } from "./memory"

export interface TaskAnalysis {
  description: string
  taskType: string
  requiredCapabilities: AICapability[]
  complexity: "trivial" | "simple" | "moderate" | "complex" | "massive"
  sensitivityLevel: "public" | "internal" | "confidential" | "secret"
  needsRealtime: boolean
  needsMultimodal: boolean
  preferCheap: boolean
  estimatedTokens: number
}

export interface RoutingDecision {
  member: FederationMember
  confidence: number
  reason: string
  alternatives: FederationMember[]
  costEstimate: number
}

export namespace UltraworkRouter {
  const log = Log.create({ service: "ultrawork.router" })

  /**
   * Task type to capability mapping
   * Defines which AI capabilities are needed for each type of task
   */
  const TASK_CAPABILITY_MAP: Record<string, AICapability[]> = {
    architecture: ["architecture", "reasoning"],
    coding: ["coding"],
    research: ["research", "web_browsing"],
    testing: ["testing", "coding"],
    documentation: ["documentation", "creative"],
    design: ["creative", "multimodal"],
    deployment: ["coding", "security"],
    optimization: ["optimization", "math"],
    review: ["reasoning", "security"],
    integration: ["coding", "architecture"],
    data: ["data_analysis", "math"],
    security: ["security", "reasoning"],
    i18n: ["i18n"],
    realtime: ["realtime_data"],
  }

  /**
   * Analyze a task to determine its routing requirements
   */
  export function analyze(description: string, taskType?: string): TaskAnalysis {
    const lower = description.toLowerCase()

    // Detect task type from content if not provided
    const detectedType = taskType ?? detectTaskType(lower)

    // Determine required capabilities
    const requiredCapabilities: AICapability[] = TASK_CAPABILITY_MAP[detectedType] ?? ["coding"]

    // Additional capability detection from description
    if (lower.includes("image") || lower.includes("screenshot") || lower.includes("visual")) {
      requiredCapabilities.push("multimodal")
    }
    if (lower.includes("translat") || lower.includes("i18n") || lower.includes("localiz")) {
      requiredCapabilities.push("i18n")
    }
    if (lower.includes("real-time") || lower.includes("live") || lower.includes("current")) {
      requiredCapabilities.push("realtime_data")
    }
    if (lower.includes("math") || lower.includes("algorithm") || lower.includes("calcul")) {
      requiredCapabilities.push("math")
    }
    if (lower.includes("secur") || lower.includes("vulnerab") || lower.includes("auth")) {
      requiredCapabilities.push("security")
    }

    // Estimate complexity
    const complexity = estimateComplexity(description)

    // Estimate token usage
    const estimatedTokens = Math.max(1000, description.length * 10)

    return {
      description,
      taskType: detectedType,
      requiredCapabilities: [...new Set(requiredCapabilities)],
      complexity,
      sensitivityLevel: detectSensitivity(lower),
      needsRealtime: requiredCapabilities.includes("realtime_data"),
      needsMultimodal: requiredCapabilities.includes("multimodal"),
      preferCheap: complexity === "trivial" || complexity === "simple",
      estimatedTokens,
    }
  }

  /**
   * Route a task to the best AI in the federation
   */
  export function route(analysis: TaskAnalysis): FederationMember {
    log.info("routing task", {
      type: analysis.taskType,
      capabilities: analysis.requiredCapabilities,
      complexity: analysis.complexity,
    })

    // Check memory for historical performance data
    const historicalBest = UltraworkMemory.getBestAIForTask(analysis.taskType)

    // For confidential/secret tasks, prefer local GPU
    if (analysis.sensitivityLevel === "secret" || analysis.sensitivityLevel === "confidential") {
      const local = UltraworkFederation.get("local-gpu")
      if (local?.enabled) {
        log.info("routing to local GPU for privacy", { taskType: analysis.taskType })
        return local
      }
    }

    // For cheap/simple tasks, use cost-optimized routing
    if (analysis.preferCheap && analysis.requiredCapabilities.length === 1) {
      const cheap = UltraworkFederation.findCheapest(analysis.requiredCapabilities[0])
      if (cheap) {
        log.info("cost-optimized routing", { member: cheap.id, taskType: analysis.taskType })
        return cheap
      }
    }

    // Use historical data if available and confidence is high
    if (historicalBest) {
      const member = UltraworkFederation.get(historicalBest.aiId)
      if (member?.enabled && historicalBest.successRate > 0.8) {
        log.info("routing based on historical performance", {
          member: member.id,
          successRate: historicalBest.successRate,
        })
        return member
      }
    }

    // Default: find best match by capabilities
    const best = UltraworkFederation.findBest(analysis.requiredCapabilities)
    if (best) {
      log.info("capability-matched routing", { member: best.id, taskType: analysis.taskType })
      return best
    }

    // Ultimate fallback: Claude Opus 4.5 (the brain handles everything)
    const fallback = UltraworkFederation.get("claude-opus-4-5")!
    log.info("fallback routing to ATLAS brain", { taskType: analysis.taskType })
    return fallback
  }

  /**
   * Get a full routing decision with alternatives and cost estimate
   */
  export function routeWithDetails(analysis: TaskAnalysis): RoutingDecision {
    const primary = route(analysis)
    const allCandidates = UltraworkFederation.active().filter((m) => m.id !== primary.id)

    // Score alternatives
    const alternatives = allCandidates
      .map((member) => {
        let score = 0
        for (const cap of analysis.requiredCapabilities) {
          if (member.strengths.includes(cap)) score += 10
          if (member.weaknesses.includes(cap)) score -= 5
        }
        return { member, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.member)

    // Estimate cost (rough per-1M-token pricing)
    const costPerMillion: Record<string, number> = {
      free: 0,
      low: 0.5,
      medium: 3,
      high: 10,
      premium: 30,
    }
    const costEstimate = (analysis.estimatedTokens / 1_000_000) * (costPerMillion[primary.costTier] ?? 10)

    // Calculate confidence
    let confidence = 0.7
    const matchedCaps = analysis.requiredCapabilities.filter((c) => primary.strengths.includes(c))
    confidence = matchedCaps.length / Math.max(analysis.requiredCapabilities.length, 1)
    confidence = Math.min(1.0, Math.max(0.1, confidence))

    return {
      member: primary,
      confidence,
      reason: `Best match for ${analysis.taskType}: ${matchedCaps.join(", ")} capabilities`,
      alternatives,
      costEstimate,
    }
  }

  /**
   * Get a fallback AI when the primary one fails
   */
  export function getFallback(failedMemberId: string, analysis: TaskAnalysis): FederationMember | undefined {
    const decision = routeWithDetails(analysis)
    return decision.alternatives.find((m) => m.id !== failedMemberId)
  }

  // --- Internal helpers ---

  function detectTaskType(description: string): string {
    const patterns: [string, RegExp[]][] = [
      ["architecture", [/architect/i, /design system/i, /infrastructure/i, /plan/i, /structure/i]],
      ["coding", [/implement/i, /code/i, /build/i, /create/i, /develop/i, /write.*function/i, /program/i]],
      ["research", [/research/i, /find/i, /search/i, /look up/i, /investigate/i, /explore/i]],
      ["testing", [/test/i, /verify/i, /validate/i, /check/i, /assert/i, /qa/i]],
      ["documentation", [/document/i, /readme/i, /explain/i, /comment/i, /describe/i]],
      ["design", [/design/i, /ui/i, /ux/i, /layout/i, /visual/i, /mockup/i]],
      ["deployment", [/deploy/i, /ci\/cd/i, /docker/i, /kubernetes/i, /release/i]],
      ["optimization", [/optimi/i, /performance/i, /speed/i, /efficient/i, /refactor/i]],
      ["review", [/review/i, /audit/i, /inspect/i, /analyze/i]],
      ["integration", [/integrat/i, /connect/i, /api/i, /webhook/i]],
      ["data", [/data/i, /database/i, /sql/i, /analytics/i, /csv/i, /json/i]],
      ["security", [/security/i, /vulnerab/i, /encrypt/i, /auth/i, /permission/i]],
      ["i18n", [/translat/i, /i18n/i, /localiz/i, /multilingual/i, /language/i]],
      ["realtime", [/real.?time/i, /live/i, /stream/i, /websocket/i, /notification/i]],
    ]

    for (const [type, regexes] of patterns) {
      if (regexes.some((r) => r.test(description))) return type
    }

    return "coding" // default
  }

  function estimateComplexity(
    description: string,
  ): "trivial" | "simple" | "moderate" | "complex" | "massive" {
    const words = description.split(/\s+/).length
    if (words < 10) return "trivial"
    if (words < 30) return "simple"
    if (words < 100) return "moderate"
    if (words < 300) return "complex"
    return "massive"
  }

  function detectSensitivity(description: string): "public" | "internal" | "confidential" | "secret" {
    if (/password|secret|credential|private.?key|api.?key|token/i.test(description)) return "secret"
    if (/internal|proprietary|confidential/i.test(description)) return "confidential"
    if (/private|restricted/i.test(description)) return "internal"
    return "public"
  }
}
