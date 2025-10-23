/**
 * Self-Healing System
 *
 * Dynamically adapts prompts, configurations, and workflows based on
 * learned patterns from the heuristics engine.
 */

import { Storage } from "../storage/storage.js"
import { ulid } from "ulid"
import { Log } from "../util/log.js"
import { Heuristics } from "./heuristics.js"
import { Metrics } from "./metrics.js"
import type {
  Adaptation,
  AdaptationChange,
  AdaptationType,
  WorkflowContext,
  Issue,
  FailurePattern,
  Optimization,
} from "./types.js"

const log = Log.create({ service: "self-healing" })

export namespace SelfHealing {
  const MIN_OCCURRENCES = 3 // Minimum pattern occurrences before adapting
  const CONFIDENCE_THRESHOLD = 0.7 // Minimum confidence for auto-adaptation

  /**
   * Detect issues in the current workflow context
   */
  export async function detectIssue(context: WorkflowContext): Promise<Issue | null> {
    // Check for known failure patterns
    const patterns = await Heuristics.getPatterns()

    for (const pattern of patterns) {
      // Check if current errors match this pattern
      for (const error of context.recentErrors) {
        if (error.type === pattern.type && error.stage === context.currentStage) {
          return {
            id: ulid(),
            type: "known_failure_pattern",
            description: `Detected known failure pattern: ${pattern.description}`,
            severity: pattern.occurrences > 10 ? "high" : "medium",
            context,
            suggestedAction: pattern.suggestedFix,
          }
        }
      }
    }

    // Check for performance degradation
    if (context.currentTask) {
      const estimatedTime = context.currentTask.estimatedTime
      const actualTime = context.currentTask.actualTime || 0

      if (actualTime > estimatedTime * 2) {
        return {
          id: ulid(),
          type: "performance_degradation",
          description: `Task taking ${Math.round(actualTime / estimatedTime)}x longer than estimated`,
          severity: "medium",
          context,
          suggestedAction: "Review task complexity or agent efficiency",
        }
      }
    }

    // Check for repeated failures
    const recentFailures = context.recentErrors.filter(
      e => e.timestamp > Date.now() - 60 * 60 * 1000 // Last hour
    )

    if (recentFailures.length >= 3) {
      return {
        id: ulid(),
        type: "repeated_failures",
        description: `${recentFailures.length} failures in the last hour`,
        severity: "high",
        context,
        suggestedAction: "Pause workflow and review recent errors",
      }
    }

    return null
  }

  /**
   * Generate an adaptation for a detected issue
   */
  export async function generateAdaptation(issue: Issue): Promise<Adaptation> {
    log.info("Generating adaptation for issue", { issueType: issue.type })

    const adaptationID = ulid()

    // Based on issue type, generate appropriate adaptation
    switch (issue.type) {
      case "known_failure_pattern":
        return generatePromptAdaptation(issue, adaptationID)

      case "performance_degradation":
        return generateWorkflowAdaptation(issue, adaptationID)

      case "repeated_failures":
        return generateToolRestrictionAdaptation(issue, adaptationID)

      default:
        return generateGenericAdaptation(issue, adaptationID)
    }
  }

  /**
   * Apply an adaptation
   */
  export async function applyAdaptation(adaptation: Adaptation): Promise<void> {
    log.info("Applying adaptation", {
      adaptationID: adaptation.id,
      type: adaptation.type,
    })

    // Save adaptation
    await Storage.write(["adaptation", adaptation.id], adaptation)

    // Mark as active
    await Storage.update(["adaptation", adaptation.id], (draft) => {
      draft.active = true
      draft.appliedAt = Date.now()
    })

    // Apply based on type
    switch (adaptation.type) {
      case "prompt_modification":
        await applyPromptModification(adaptation)
        break

      case "tool_restriction":
        await applyToolRestriction(adaptation)
        break

      case "workflow_adjustment":
        await applyWorkflowAdjustment(adaptation)
        break
    }

    log.info("Adaptation applied successfully", { adaptationID: adaptation.id })
  }

  /**
   * Rollback an adaptation
   */
  export async function rollbackAdaptation(adaptationID: string): Promise<void> {
    const adaptation = await Storage.read<Adaptation>(["adaptation", adaptationID])

    if (!adaptation) {
      throw new Error(`Adaptation ${adaptationID} not found`)
    }

    log.info("Rolling back adaptation", { adaptationID })

    // Revert changes based on type
    switch (adaptation.type) {
      case "prompt_modification":
        await rollbackPromptModification(adaptation)
        break

      case "tool_restriction":
        await rollbackToolRestriction(adaptation)
        break

      case "workflow_adjustment":
        await rollbackWorkflowAdjustment(adaptation)
        break
    }

    // Mark as inactive
    await Storage.update<Adaptation>(["adaptation", adaptationID], (draft) => {
      draft.active = false
      draft.rolledBackAt = Date.now()
    })

    log.info("Adaptation rolled back successfully", { adaptationID })
  }

  /**
   * Evaluate adaptation effectiveness
   */
  export async function evaluateAdaptation(adaptationID: string): Promise<number> {
    const adaptation = await Storage.read<Adaptation>(["adaptation", adaptationID])

    if (!adaptation) {
      throw new Error(`Adaptation ${adaptationID} not found`)
    }

    // Get metrics before and after adaptation
    const beforeMetrics = await getMetricsBeforeAdaptation(adaptation)
    const afterMetrics = await getMetricsAfterAdaptation(adaptation)

    if (!beforeMetrics || !afterMetrics) {
      return 0
    }

    // Calculate effectiveness based on error reduction
    const errorRateBefore = beforeMetrics.errorRate
    const errorRateAfter = afterMetrics.errorRate

    const improvement = errorRateBefore > 0
      ? (errorRateBefore - errorRateAfter) / errorRateBefore
      : 0

    // Update adaptation effectiveness
    await Storage.update<Adaptation>(["adaptation", adaptationID], (draft) => {
      draft.effectiveness = improvement
    })

    return improvement
  }

  /**
   * Automatically apply optimizations from heuristics
   */
  export async function autoApplyOptimizations(): Promise<Adaptation[]> {
    const optimizations = await Heuristics.suggestOptimizations()
    const appliedAdaptations: Adaptation[] = []

    for (const optimization of optimizations) {
      // Only auto-apply low-risk optimizations with high expected improvement
      if (optimization.riskLevel === "low" && optimization.expectedImprovement > 0.5) {
        const adaptation = await createAdaptationFromOptimization(optimization)
        await applyAdaptation(adaptation)
        appliedAdaptations.push(adaptation)
      }
    }

    return appliedAdaptations
  }

  /**
   * Monitor and maintain adaptations
   */
  export async function maintainAdaptations(): Promise<void> {
    const adaptationKeys = await Storage.list(["adaptation"])
    const adaptations = await Promise.all(
      adaptationKeys.map(key => Storage.read<Adaptation>(key))
    )

    for (const adaptation of adaptations) {
      if (!adaptation.active) continue

      // Evaluate effectiveness
      const effectiveness = await evaluateAdaptation(adaptation.id)

      // Rollback ineffective adaptations
      if (effectiveness < -0.1) {
        log.warn("Rolling back ineffective adaptation", {
          adaptationID: adaptation.id,
          effectiveness,
        })
        await rollbackAdaptation(adaptation.id)
      }

      // Keep effective adaptations
      if (effectiveness > 0.3) {
        log.info("Adaptation is effective, keeping active", {
          adaptationID: adaptation.id,
          effectiveness,
        })
      }
    }
  }

  /**
   * Generate prompt modification adaptation
   */
  function generatePromptAdaptation(issue: Issue, adaptationID: string): Adaptation {
    const change: AdaptationChange = {
      field: "prompt",
      before: null, // Would need to fetch current prompt
      after: `\n\nIMPORTANT: ${issue.suggestedAction}`,
    }

    return {
      id: adaptationID,
      type: "prompt_modification",
      target: issue.context.currentStage, // Target the current stage's agent
      changes: [change],
      reason: issue.description,
      appliedAt: 0,
      active: false,
    }
  }

  /**
   * Generate workflow adjustment adaptation
   */
  function generateWorkflowAdaptation(issue: Issue, adaptationID: string): Adaptation {
    const change: AdaptationChange = {
      field: "timeout",
      before: 0, // Would need current timeout
      after: issue.context.currentTask
        ? issue.context.currentTask.estimatedTime * 3
        : 0,
    }

    return {
      id: adaptationID,
      type: "workflow_adjustment",
      target: issue.context.currentStage,
      changes: [change],
      reason: issue.description,
      appliedAt: 0,
      active: false,
    }
  }

  /**
   * Generate tool restriction adaptation
   */
  function generateToolRestrictionAdaptation(issue: Issue, adaptationID: string): Adaptation {
    // Find the most commonly failing tool
    const toolErrors = issue.context.recentErrors
      .map(e => e.context.tool as string)
      .filter(Boolean)

    const toolCounts = toolErrors.reduce((acc, tool) => {
      acc[tool] = (acc[tool] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const mostFailingTool = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0]

    if (mostFailingTool) {
      const change: AdaptationChange = {
        field: `tools.${mostFailingTool}`,
        before: true,
        after: false,
      }

      return {
        id: adaptationID,
        type: "tool_restriction",
        target: issue.context.currentStage,
        changes: [change],
        reason: `Tool ${mostFailingTool} causing repeated failures: ${issue.description}`,
        appliedAt: 0,
        active: false,
      }
    }

    return generateGenericAdaptation(issue, adaptationID)
  }

  /**
   * Generate generic adaptation
   */
  function generateGenericAdaptation(issue: Issue, adaptationID: string): Adaptation {
    return {
      id: adaptationID,
      type: "prompt_modification",
      target: issue.context.currentStage,
      changes: [],
      reason: issue.description,
      appliedAt: 0,
      active: false,
    }
  }

  /**
   * Create adaptation from optimization
   */
  async function createAdaptationFromOptimization(
    optimization: Optimization
  ): Promise<Adaptation> {
    const adaptationID = ulid()

    let type: AdaptationType
    if (optimization.target === "prompt") {
      type = "prompt_modification"
    } else if (optimization.target === "agent_config") {
      type = "workflow_adjustment"
    } else {
      type = "workflow_adjustment"
    }

    const changes: AdaptationChange[] = Object.entries(optimization.implementation.parameters)
      .map(([key, value]) => ({
        field: key,
        before: null,
        after: value,
      }))

    return {
      id: adaptationID,
      type,
      target: optimization.implementation.parameters.agentID ||
              optimization.implementation.parameters.stage ||
              "global",
      changes,
      reason: optimization.description,
      appliedAt: 0,
      active: false,
    }
  }

  /**
   * Apply prompt modification
   */
  async function applyPromptModification(adaptation: Adaptation): Promise<void> {
    // Would integrate with agent configuration system
    // For now, just save the adaptation
    await Storage.write(
      ["adaptation_applied", "prompt", adaptation.target],
      adaptation
    )
  }

  /**
   * Apply tool restriction
   */
  async function applyToolRestriction(adaptation: Adaptation): Promise<void> {
    // Would integrate with agent configuration system
    await Storage.write(
      ["adaptation_applied", "tools", adaptation.target],
      adaptation
    )
  }

  /**
   * Apply workflow adjustment
   */
  async function applyWorkflowAdjustment(adaptation: Adaptation): Promise<void> {
    // Would integrate with workflow configuration system
    await Storage.write(
      ["adaptation_applied", "workflow", adaptation.target],
      adaptation
    )
  }

  /**
   * Rollback prompt modification
   */
  async function rollbackPromptModification(adaptation: Adaptation): Promise<void> {
    await Storage.remove(["adaptation_applied", "prompt", adaptation.target])
  }

  /**
   * Rollback tool restriction
   */
  async function rollbackToolRestriction(adaptation: Adaptation): Promise<void> {
    await Storage.remove(["adaptation_applied", "tools", adaptation.target])
  }

  /**
   * Rollback workflow adjustment
   */
  async function rollbackWorkflowAdjustment(adaptation: Adaptation): Promise<void> {
    await Storage.remove(["adaptation_applied", "workflow", adaptation.target])
  }

  /**
   * Get metrics before adaptation
   */
  async function getMetricsBeforeAdaptation(
    adaptation: Adaptation
  ): Promise<{ errorRate: number } | null> {
    // Would analyze metrics from before adaptation.appliedAt
    // Simplified implementation
    return { errorRate: 0.2 }
  }

  /**
   * Get metrics after adaptation
   */
  async function getMetricsAfterAdaptation(
    adaptation: Adaptation
  ): Promise<{ errorRate: number } | null> {
    // Would analyze metrics from after adaptation.appliedAt
    // Simplified implementation
    return { errorRate: 0.1 }
  }

  /**
   * Get all active adaptations
   */
  export async function getActiveAdaptations(): Promise<Adaptation[]> {
    const keys = await Storage.list(["adaptation"])
    const adaptations = await Promise.all(
      keys.map(key => Storage.read<Adaptation>(key))
    )

    return adaptations.filter(a => a.active)
  }

  /**
   * Get adaptation by ID
   */
  export async function getAdaptation(adaptationID: string): Promise<Adaptation | null> {
    try {
      return await Storage.read<Adaptation>(["adaptation", adaptationID])
    } catch {
      return null
    }
  }
}
