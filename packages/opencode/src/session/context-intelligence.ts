import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { generateObject } from "ai"
import { z } from "zod"

export namespace ContextIntelligence {
  const log = Log.create({ service: "context-intelligence" })

  // Schema for extracted entities and tasks
  const AnalysisSchema = z.object({
    actionable_entities: z.array(
      z.object({
        type: z.enum(["url", "file", "api_endpoint", "database_table", "config_option"]),
        value: z.string(),
        description: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        confidence: z.number().min(0).max(1),
      }),
    ),
    tasks: z.array(
      z.object({
        description: z.string(),
        type: z.enum(["research", "implementation", "documentation", "testing", "configuration"]),
        priority: z.enum(["high", "medium", "low"]),
        dependencies: z.array(z.string()).optional(),
        estimated_effort: z.enum(["quick", "medium", "large"]),
        confidence: z.number().min(0).max(1),
      }),
    ),
    relevance: z.object({
      is_outdated: z.boolean(),
      relevance_score: z.number().min(0).max(1),
      reasons: z.array(z.string()),
      suggested_action: z.enum(["keep", "archive", "update", "remove"]),
    }),
    traffic_light_prediction: z.object({
      priority: z.enum(["high", "medium", "low"]),
      urgency: z.enum(["immediate", "soon", "later"]),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  })

  type ContextAnalysis = z.infer<typeof AnalysisSchema>

  // In-memory store for learning data
  let learningData: {
    userOverrides: Array<{
      contextId: string
      originalPrediction: string
      userChoice: string
      timestamp: Date
    }>
    messageOutcomes: Array<{
      sessionId: string
      contextUsed: string[]
      success: boolean
      timestamp: Date
    }>
  } = {
    userOverrides: [],
    messageOutcomes: [],
  }

  /**
   * Get a small, cost-effective model for context analysis
   */
  async function getAnalysisModel() {
    try {
      // Try to get Anthropic Haiku 4.5 first (cheapest and best for this task)
      const smallModel = await Provider.getSmallModel("anthropic")
      if (smallModel) {
        return smallModel.language
      }

      // Fallback to any available small model
      const providers = await Provider.list()
      for (const provider of Object.values(providers)) {
        const smallModel = await Provider.getSmallModel(provider.info.id)
        if (smallModel) {
          return smallModel.language
        }
      }

      // Final fallback to default model
      const defaultModel = await Provider.defaultModel()
      return (await Provider.getModel(defaultModel.providerID, defaultModel.modelID)).language
    } catch (error) {
      log.error("Failed to get analysis model", { error })
      throw error
    }
  }

  /**
   * Analyze context content for actionable entities, tasks, and relevance
   */
  export async function analyzeContext(contextItem: {
    id: string
    name: string
    content: string
  }): Promise<ContextAnalysis> {
    try {
      log.info("Starting context analysis", { contextId: contextItem.id, name: contextItem.name })

      const model = await getAnalysisModel()

      // Build learning context from historical data
      const learningContext = buildLearningContext()

      const result = await generateObject({
        model,
        schema: AnalysisSchema,
        messages: [
          {
            role: "system",
            content: `You are a context intelligence agent that analyzes context items to extract actionable entities, tasks, and assess relevance.

Your job is to:
1. Extract actionable entities (URLs, files, APIs, configs, etc.) that could be used in development
2. Identify potential tasks that could emerge from this context
3. Assess whether the context is still relevant or outdated
4. Predict traffic light priority (high/medium/low) and urgency (immediate/soon/later)

${learningContext ? `Learning from past user interactions:\n${learningContext}` : ""}

Be precise and practical. Focus on concrete, actionable items rather than abstract concepts.`,
          },
          {
            role: "user",
            content: `Analyze this context item:

Name: ${contextItem.name}
Content: ${contextItem.content}

Extract actionable entities, potential tasks, assess relevance, and predict priority/urgency.`,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent analysis
      })

      log.info("Context analysis completed", {
        contextId: contextItem.id,
        entitiesFound: result.object.actionable_entities.length,
        tasksFound: result.object.tasks.length,
        relevanceScore: result.object.relevance.relevance_score,
      })

      return result.object
    } catch (error) {
      log.error("Context analysis failed", { contextId: contextItem.id, error })
      throw error
    }
  }

  /**
   * Build learning context from historical user interactions
   */
  function buildLearningContext(): string | null {
    if (learningData.userOverrides.length === 0 && learningData.messageOutcomes.length === 0) {
      return null
    }

    const recent = learningData.userOverrides.slice(-10) // Last 10 overrides
    const outcomes = learningData.messageOutcomes.slice(-20) // Last 20 outcomes

    let context = "User behavior patterns:\n"

    if (recent.length > 0) {
      context += "Recent priority corrections:\n"
      recent.forEach((override) => {
        context += `- Changed "${override.originalPrediction}" to "${override.userChoice}"\n`
      })
    }

    if (outcomes.length > 0) {
      const successRate = outcomes.filter((o) => o.success).length / outcomes.length
      context += `\nMessage success rate: ${Math.round(successRate * 100)}%\n`
      context += "Most effective context patterns: "
      // Simple pattern analysis - could be enhanced with more sophisticated ML
      const successful = outcomes.filter((o) => o.success)
      const patterns = successful.map((o) => o.contextUsed.join(", "))
      context += patterns.slice(0, 3).join("; ")
    }

    return context
  }

  /**
   * Update traffic lights based on model prediction and user rules
   */
  export async function updateTrafficLights(
    analyses: ContextAnalysis[],
    userRules?: {
      highPriorityKeywords?: string[]
      lowPriorityKeywords?: string[]
      urgencyBoosts?: string[]
    },
  ): Promise<{
    priority: "high" | "medium" | "low"
    urgency: "immediate" | "soon" | "later"
    reasoning: string
  }> {
    // Aggregate predictions from all context analyses
    const predictions = analyses.map((a) => a.traffic_light_prediction)

    // Weight by confidence
    const weightedPriority = calculateWeightedPriority(predictions)
    const weightedUrgency = calculateWeightedUrgency(predictions)

    // Apply user rules
    let finalPriority = weightedPriority
    let finalUrgency = weightedUrgency
    let reasoning = "Based on context analysis"

    if (userRules) {
      const allContent = analyses
        .map(
          (a) =>
            `${a.actionable_entities.map((e) => e.value).join(" ")} ${a.tasks.map((t) => t.description).join(" ")}`,
        )
        .join(" ")
        .toLowerCase()

      // Check for high priority keywords
      if (userRules.highPriorityKeywords?.some((keyword) => allContent.includes(keyword.toLowerCase()))) {
        finalPriority = "high"
        reasoning += ", elevated by user rules (high priority keywords)"
      }

      // Check for low priority keywords
      if (userRules.lowPriorityKeywords?.some((keyword) => allContent.includes(keyword.toLowerCase()))) {
        finalPriority = "low"
        reasoning += ", reduced by user rules (low priority keywords)"
      }

      // Check for urgency boosts
      if (userRules.urgencyBoosts?.some((keyword) => allContent.includes(keyword.toLowerCase()))) {
        finalUrgency = finalUrgency === "later" ? "soon" : "immediate"
        reasoning += ", urgency boosted by user rules"
      }
    }

    return {
      priority: finalPriority,
      urgency: finalUrgency,
      reasoning,
    }
  }

  function calculateWeightedPriority(
    predictions: ContextAnalysis["traffic_light_prediction"][],
  ): "high" | "medium" | "low" {
    const weights = { high: 3, medium: 2, low: 1 }
    let totalWeight = 0
    let totalConfidence = 0

    predictions.forEach((pred) => {
      const weight = weights[pred.priority] * pred.confidence
      totalWeight += weight
      totalConfidence += pred.confidence
    })

    if (totalConfidence === 0) return "medium"

    const average = totalWeight / totalConfidence
    if (average >= 2.5) return "high"
    if (average >= 1.5) return "medium"
    return "low"
  }

  function calculateWeightedUrgency(
    predictions: ContextAnalysis["traffic_light_prediction"][],
  ): "immediate" | "soon" | "later" {
    const weights = { immediate: 3, soon: 2, later: 1 }
    let totalWeight = 0
    let totalConfidence = 0

    predictions.forEach((pred) => {
      const weight = weights[pred.urgency] * pred.confidence
      totalWeight += weight
      totalConfidence += pred.confidence
    })

    if (totalConfidence === 0) return "soon"

    const average = totalWeight / totalConfidence
    if (average >= 2.5) return "immediate"
    if (average >= 1.5) return "soon"
    return "later"
  }

  /**
   * Track user override for learning
   */
  export function trackUserOverride(contextId: string, originalPrediction: string, userChoice: string) {
    learningData.userOverrides.push({
      contextId,
      originalPrediction,
      userChoice,
      timestamp: new Date(),
    })

    // Keep only last 100 overrides to prevent memory bloat
    if (learningData.userOverrides.length > 100) {
      learningData.userOverrides = learningData.userOverrides.slice(-100)
    }

    log.info("Tracked user override", { contextId, originalPrediction, userChoice })
  }

  /**
   * Track message outcome for learning
   */
  export function trackMessageOutcome(sessionId: string, contextUsed: string[], success: boolean) {
    learningData.messageOutcomes.push({
      sessionId,
      contextUsed,
      success,
      timestamp: new Date(),
    })

    // Keep only last 200 outcomes
    if (learningData.messageOutcomes.length > 200) {
      learningData.messageOutcomes = learningData.messageOutcomes.slice(-200)
    }

    log.info("Tracked message outcome", { sessionId, contextUsed, success })
  }

  /**
   * Process context in background (non-blocking)
   */
  export function processContextBackground(contextItem: {
    id: string
    name: string
    content: string
  }): Promise<ContextAnalysis> {
    // Return immediately, process in background
    return new Promise((resolve, reject) => {
      // Use setTimeout to make it truly non-blocking
      setTimeout(async () => {
        try {
          const analysis = await analyzeContext(contextItem)
          resolve(analysis)
        } catch (error) {
          reject(error)
        }
      }, 0)
    })
  }

  /**
   * Fetch content from URLs in context
   */
  export async function fetchContextContent(content: string): Promise<string> {
    const urlRegex = /https?:\/\/[^\s]+/g
    const urls = content.match(urlRegex)

    if (!urls || urls.length === 0) {
      return content
    }

    try {
      // Fetch first URL only to avoid rate limiting
      const url = urls[0]!
      log.info("Fetching context URL", { url })

      const response = await fetch(url, {
        headers: {
          "User-Agent": "OpenCode Context Intelligence Bot 1.0",
        },
      })

      if (!response.ok) {
        log.warn("Failed to fetch URL", { url, status: response.status })
        return content
      }

      const fetchedContent = await response.text()

      // Simple text extraction - remove HTML if present
      const textContent = fetchedContent
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()

      return `${content}\n\nFetched content from ${url}:\n${textContent.slice(0, 2000)}${textContent.length > 2000 ? "..." : ""}`
    } catch (error) {
      log.warn("Error fetching URL content", { error })
      return content
    }
  }
}
