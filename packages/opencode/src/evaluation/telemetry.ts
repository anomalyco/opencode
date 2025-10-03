/**
 * Telemetry collection for production insights.
 * 
 * Enriches traces with contextual metadata to enable:
 * - Cost attribution and analysis
 * - Quality prediction without user input
 * - Performance segmentation
 * - Self-improving evaluation
 * 
 * Key principles:
 * - Non-invasive: Doesn't modify core trace schema
 * - Opt-in: Only collected when evaluation is enabled
 * - Async: Never blocks user operations
 * - Privacy-preserving: Metadata only, no code content
 */

import z from "zod/v4"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import type { Trace } from "../trace"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileWatcher } from "../file/watcher"

const log = Log.create({ service: "evaluation.telemetry" })

export namespace Telemetry {
  /**
   * Codebase characteristics for context.
   */
  export const CodebaseContext = z.object({
    size: z.object({
      files: z.number(),
      lines: z.number(),
    }),
    primaryLanguage: z.string(), // Most common file extension
    architecture: z.enum(["monolith", "microservices", "unknown"]),
    testCoverage: z.number().optional(), // If detectable
  })
  export type CodebaseContext = z.infer<typeof CodebaseContext>

  /**
   * Task classification based on trace characteristics.
   */
  export const TaskClassification = z.object({
    type: z.enum(["edit", "refactor", "debug", "review", "explore", "unknown"]),
    complexity: z.enum(["simple", "medium", "complex"]),
    confidence: z.number().min(0).max(1), // How confident are we?
  })
  export type TaskClassification = z.infer<typeof TaskClassification>

  /**
   * Outcome proxies (quality signals without user feedback).
   */
  export const OutcomeProxies = z.object({
    subsequentEdits: z.number().default(0), // Edits to same files within 1 hour
    subsequentEditWindow: z.number().default(60 * 60 * 1000), // 1 hour in ms
    gitReverted: z.boolean().optional(), // Was change reverted?
    testResults: z
      .object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
      })
      .optional(),
  })
  export type OutcomeProxies = z.infer<typeof OutcomeProxies>

  /**
   * Enriched trace metadata.
   */
  export const EnrichedMetadata = z.object({
    traceID: z.string(),
    timestamp: z.number(),

    // Context
    codebaseContext: CodebaseContext.optional(),
    taskClassification: TaskClassification,

    // Attribution
    userEmail: z.string().optional(),
    teamID: z.string().optional(),
    environment: z.enum(["development", "production", "staging"]).optional(),

    // Outcome tracking
    outcomeProxies: OutcomeProxies,

    // Metadata
    collectedAt: z.number(),
    version: z.string().default("1.0.0"),
  })
  export type EnrichedMetadata = z.infer<typeof EnrichedMetadata>

  /**
   * User feedback for specific traces.
   */
  export const UserFeedback = z.object({
    traceID: z.string(),
    timestamp: z.number(),

    // Structured questions
    responses: z.object({
      correctness: z.number().min(1).max(5).optional(), // 1-5 rating
      speed: z.enum(["too-slow", "acceptable", "fast"]).optional(),
      wouldUseAgain: z.boolean().optional(),
    }),

    // Freeform
    comment: z.string().optional(),

    // Context
    requestedAt: z.number(),
    respondedAt: z.number(),
  })
  export type UserFeedback = z.infer<typeof UserFeedback>

  /**
   * Feedback request configuration.
   */
  export const FeedbackRequest = z.object({
    traceIDs: z.array(z.string()),
    questions: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["rating", "choice", "boolean", "text"]),
        question: z.string(),
        options: z.array(z.string()).optional(),
      })
    ),
    requestedAt: z.number(),
  })
  export type FeedbackRequest = z.infer<typeof FeedbackRequest>

  /**
   * Events for telemetry system.
   */
  export const Event = {
    Enriched: Bus.event(
      "telemetry.enriched",
      z.object({
        metadata: EnrichedMetadata,
      })
    ),
    FeedbackRequested: Bus.event(
      "telemetry.feedback_requested",
      z.object({
        request: FeedbackRequest,
      })
    ),
    FeedbackReceived: Bus.event(
      "telemetry.feedback_received",
      z.object({
        feedback: UserFeedback,
      })
    ),
  }

  // Track file edits for outcome detection (reserved for future use)
  // const recentEdits = new Map<string, Array<{ file: string; timestamp: number }>>()

  /**
   * Classify task type based on trace characteristics.
   */
  function classifyTask(trace: Trace.Complete): TaskClassification {
    const { toolCalls, summary } = trace

    // Count tool types
    const toolTypes = new Map<string, number>()
    for (const call of toolCalls) {
      // Tool name can be in 'tool' property or 'id' property (from realistic traces)
      const name = (call as any).tool || (call as any).id || "unknown"
      toolTypes.set(name, (toolTypes.get(name) || 0) + 1)
    }

    // Heuristics for task type
    let type: TaskClassification["type"] = "unknown"
    let confidence = 0.5

    // Explore: Mostly Read/Grep
    const readCount = (toolTypes.get("Read") || 0) + (toolTypes.get("Grep") || 0)
    const editCount =
      (toolTypes.get("Edit") || 0) +
      (toolTypes.get("MultiEdit") || 0) +
      (toolTypes.get("Create") || 0)
    const executeCount = toolTypes.get("Execute") || 0

    if (readCount > editCount * 3 && editCount < 2) {
      type = "explore"
      confidence = 0.8
    }
    // Debug: Errors with retries (any execute + errors)
    else if (summary.errorCount > 0 && executeCount > 0) {
      type = "debug"
      confidence = 0.75
    }
    // Refactor: MultiEdit or many edits
    else if (toolTypes.has("MultiEdit") || editCount > 3) {
      type = "refactor"
      confidence = 0.7
    }
    // Edit: Some edits with reads
    else if (editCount > 0 && editCount <= 3) {
      type = "edit"
      confidence = 0.7
    }
    // Review: Reads with no edits
    else if (readCount > 0 && editCount === 0) {
      type = "review"
      confidence = 0.6
    }

    // Determine complexity
    let complexity: TaskClassification["complexity"] = "medium"
    const totalTools = summary.toolCallCount
    const duration = summary.duration

    if (totalTools <= 3 && duration < 5000 && summary.cost < 0.01) {
      complexity = "simple"
    } else if (totalTools > 10 || duration > 30000 || summary.cost > 0.15) {
      complexity = "complex"
    }

    return { type, complexity, confidence }
  }

  /**
   * Analyze codebase to extract context.
   * Cached per project to avoid repeated scans.
   */
  const codebaseContextCache = new Map<string, CodebaseContext>()

  async function getCodebaseContext(projectID: string): Promise<CodebaseContext | undefined> {
    // Check cache
    if (codebaseContextCache.has(projectID)) {
      return codebaseContextCache.get(projectID)
    }

    try {
      const worktree = Instance.worktree

      // Skip codebase analysis if worktree is too small (test environment)
      const fileList = await Bun.$`find ${worktree} -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" 2>/dev/null | head -100 || echo ""`.text()
      const files = fileList.trim().split("\n").filter(Boolean)
      
      // If less than 3 files, it's likely a test environment
      if (files.length < 3) {
        return undefined
      }
      const fileCount = files.length

      // Sample 100 files to estimate total lines
      const sampleSize = Math.min(100, files.length)
      const sampleFiles = files.slice(0, sampleSize)
      let sampleLines = 0

      for (const file of sampleFiles) {
        try {
          const content = await Bun.file(file).text()
          sampleLines += content.split("\n").length
        } catch {
          // Skip files that can't be read
        }
      }

      const estimatedLines = Math.round((sampleLines / sampleSize) * fileCount)

      // Detect primary language
      const extensions = new Map<string, number>()
      for (const file of files) {
        const ext = file.split(".").pop()?.toLowerCase() || ""
        if (ext) {
          extensions.set(ext, (extensions.get(ext) || 0) + 1)
        }
      }

      const primaryExt =
        Array.from(extensions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown"

      const languageMap: Record<string, string> = {
        ts: "typescript",
        js: "javascript",
        tsx: "typescript",
        jsx: "javascript",
        py: "python",
        go: "go",
        rs: "rust",
        java: "java",
        rb: "ruby",
        php: "php",
        c: "c",
        cpp: "cpp",
        cs: "csharp",
      }
      const primaryLanguage = languageMap[primaryExt] || primaryExt

      // Detect architecture (simple heuristic)
      const hasDockerCompose = files.some((f) => f.includes("docker-compose"))
      const hasMultiplePackageJsons = files.filter((f) => f.endsWith("package.json")).length > 1
      const hasServicesDir = files.some((f) => f.includes("/services/") || f.includes("/apps/"))

      let architecture: CodebaseContext["architecture"] = "unknown"
      if (hasDockerCompose || hasMultiplePackageJsons || hasServicesDir) {
        architecture = "microservices"
      } else if (fileCount > 10) {
        architecture = "monolith"
      }

      const context: CodebaseContext = {
        size: {
          files: fileCount,
          lines: estimatedLines,
        },
        primaryLanguage,
        architecture,
      }

      // Cache for 1 hour
      codebaseContextCache.set(projectID, context)
      setTimeout(() => codebaseContextCache.delete(projectID), 60 * 60 * 1000)

      return context
    } catch (error) {
      log.warn("failed to analyze codebase", { error: String(error) })
      return undefined
    }
  }

  /**
   * Track subsequent edits to the same files.
   */
  function trackSubsequentEdits(traceID: string, trace: Trace.Complete) {
    // Extract files touched in this trace
    const filesEdited = new Set<string>()
    for (const call of trace.toolCalls) {
      const event = call as any
      if (
        event.tool === "Edit" ||
        event.tool === "MultiEdit" ||
        event.tool === "Create" ||
        event.tool === "Write"
      ) {
        const file = event.params?.file || event.params?.filepath
        if (file) filesEdited.add(file)
      }
    }

    if (filesEdited.size === 0) return

    // Subscribe to file watcher for the next hour
    let editCount = 0
    const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, (event) => {
      const { file } = event.properties
      if (filesEdited.has(file)) {
        editCount++
        log.debug("detected subsequent edit", { traceID, file, editCount })
      }
    })

    // After 1 hour, update outcome proxies
    setTimeout(async () => {
      unsubscribe()

      try {
        const metadata = await getEnrichedMetadata(traceID)
        if (metadata) {
          metadata.outcomeProxies.subsequentEdits = editCount
          await Storage.write(["telemetry", traceID], metadata)
          log.info("updated outcome proxies", { traceID, editCount })
        }
      } catch (error) {
        log.warn("failed to update outcome proxies", { traceID, error: String(error) })
      }
    }, 60 * 60 * 1000) // 1 hour
  }

  /**
   * Enrich a trace with telemetry metadata.
   * Called automatically when trace completes.
   */
  export async function enrichTrace(trace: Trace.Complete): Promise<EnrichedMetadata> {
    log.debug("enriching trace", { traceID: trace.id })

    // Classify task
    const taskClassification = classifyTask(trace)

    // Get codebase context (cached)
    const codebaseContext = await getCodebaseContext(trace.projectID)

    // Create enriched metadata
    const metadata: EnrichedMetadata = {
      traceID: trace.id,
      timestamp: trace.createdAt,
      codebaseContext,
      taskClassification,
      outcomeProxies: {
        subsequentEdits: 0,
        subsequentEditWindow: 60 * 60 * 1000,
      },
      collectedAt: Date.now(),
      version: "1.0.0",
    }

    // Store metadata
    await Storage.write(["telemetry", trace.id], metadata)

    // Emit event
    Bus.publish(Event.Enriched, { metadata })

    // Start tracking subsequent edits
    trackSubsequentEdits(trace.id, trace)

    log.info("trace enriched", {
      traceID: trace.id,
      taskType: taskClassification.type,
      complexity: taskClassification.complexity,
    })

    return metadata
  }

  /**
   * Get enriched metadata for a trace.
   */
  export async function getEnrichedMetadata(traceID: string): Promise<EnrichedMetadata | null> {
    try {
      const metadata = await Storage.read<EnrichedMetadata>(["telemetry", traceID])
      return metadata
    } catch {
      return null
    }
  }

  /**
   * Record user feedback for a trace.
   */
  export async function recordFeedback(feedback: UserFeedback): Promise<void> {
    await Storage.write(["feedback", feedback.traceID], feedback)
    Bus.publish(Event.FeedbackReceived, { feedback })
    log.info("feedback recorded", { traceID: feedback.traceID })
  }

  /**
   * Get user feedback for a trace.
   */
  export async function getFeedback(traceID: string): Promise<UserFeedback | null> {
    try {
      const feedback = await Storage.read<UserFeedback>(["feedback", traceID])
      return feedback
    } catch {
      return null
    }
  }

  /**
   * Request feedback for specific traces.
   * Emits an event that UI layers can subscribe to.
   */
  export async function requestFeedback(traceIDs: string[]): Promise<void> {
    const request: FeedbackRequest = {
      traceIDs,
      questions: [
        {
          id: "correctness",
          type: "rating",
          question: "How would you rate the quality of the result?",
        },
        {
          id: "speed",
          type: "choice",
          question: "Was the response time acceptable?",
          options: ["too-slow", "acceptable", "fast"],
        },
        {
          id: "wouldUseAgain",
          type: "boolean",
          question: "Would you use this feature again?",
        },
      ],
      requestedAt: Date.now(),
    }

    Bus.publish(Event.FeedbackRequested, { request })
    log.info("feedback requested", { traceCount: traceIDs.length })
  }

  /**
   * Query telemetry data with filters.
   */
  export async function query(options: {
    since?: number
    until?: number
    taskType?: TaskClassification["type"]
    complexity?: TaskClassification["complexity"]
    limit?: number
  }): Promise<EnrichedMetadata[]> {
    const keys = await Storage.list(["telemetry"])
    const results: EnrichedMetadata[] = []

    for (const key of keys) {
      try {
        const metadata = await Storage.read<EnrichedMetadata>(key)
        
        // Skip invalid/incomplete entries
        if (!metadata || !metadata.taskClassification) continue

        // Apply filters
        if (options.since && metadata.timestamp < options.since) continue
        if (options.until && metadata.timestamp > options.until) continue
        if (options.taskType && metadata.taskClassification.type !== options.taskType) continue
        if (options.complexity && metadata.taskClassification.complexity !== options.complexity)
          continue

        results.push(metadata)

        if (options.limit && results.length >= options.limit) break
      } catch {
        // Skip entries that can't be read or parsed
        continue
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get aggregated statistics from telemetry data.
   */
  export async function getStatistics(options?: {
    since?: number
    until?: number
  }): Promise<{
    totalTraces: number
    byTaskType: Record<string, number>
    byComplexity: Record<string, number>
    avgSubsequentEdits: number
  }> {
    const metadata = await query({ since: options?.since, until: options?.until })

    const byTaskType: Record<string, number> = {}
    const byComplexity: Record<string, number> = {}
    let totalSubsequentEdits = 0

    for (const m of metadata) {
      byTaskType[m.taskClassification.type] = (byTaskType[m.taskClassification.type] || 0) + 1
      byComplexity[m.taskClassification.complexity] =
        (byComplexity[m.taskClassification.complexity] || 0) + 1
      totalSubsequentEdits += m.outcomeProxies.subsequentEdits
    }

    return {
      totalTraces: metadata.length,
      byTaskType,
      byComplexity,
      avgSubsequentEdits: metadata.length > 0 ? totalSubsequentEdits / metadata.length : 0,
    }
  }

  /**
   * Clean up old telemetry data (>30 days).
   */
  export async function cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs
    const keys = await Storage.list(["telemetry"])
    let removed = 0

    for (const key of keys) {
      try {
        const metadata = await Storage.read<EnrichedMetadata>(key)
        if (metadata.timestamp < cutoff) {
          await Storage.remove(key)
          removed++
        }
      } catch {
        // Skip invalid entries
      }
    }

    log.info("telemetry cleanup completed", { removed })
    return removed
  }
}
