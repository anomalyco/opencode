import type { CompactionSchema } from "./schema"

/**
 * Quality scoring for compaction output.
 * Validates completeness and information retention.
 */
export namespace QualityScorer {
  /**
   * Weights for different sections in completeness scoring
   */
  const SECTION_WEIGHTS = {
    session_intent: 0.25,
    current_state: 0.25,
    key_context: 0.2,
    decisions: 0.1,
    pending_tasks: 0.1,
    artifacts: 0.1,
  }

  /**
   * Score template completeness (0-1)
   * Checks if critical sections are filled
   */
  export function scoreCompleteness(template: CompactionSchema.CompactionTemplate): number {
    let score = 0

    // Session intent (25%)
    if (template.session_intent && template.session_intent.length > 10) {
      score += SECTION_WEIGHTS.session_intent
    }

    // Current state (25%)
    if (template.current_state && template.current_state.length > 10) {
      score += SECTION_WEIGHTS.current_state
    }

    // Key context (20%)
    if (template.key_context && template.key_context.length > 10) {
      score += SECTION_WEIGHTS.key_context
    }

    // Decisions (10%)
    if (template.decisions && template.decisions.length > 0) {
      score += SECTION_WEIGHTS.decisions
    }

    // Pending tasks (10%)
    if (template.pending_tasks && template.pending_tasks.length > 0) {
      score += SECTION_WEIGHTS.pending_tasks
    }

    // Artifacts (10%)
    const hasArtifacts =
      template.artifacts.files_read.length > 0 ||
      template.artifacts.files_modified.length > 0 ||
      template.artifacts.files_created.length > 0
    if (hasArtifacts) {
      score += SECTION_WEIGHTS.artifacts
    }

    return Math.round(score * 100) / 100
  }

  /**
   * Score information retention (0-1)
   * Checks if important file paths from original messages are preserved
   */
  export function scoreInformationRetention(
    originalFilePaths: string[],
    template: CompactionSchema.CompactionTemplate
  ): number {
    if (originalFilePaths.length === 0) {
      return 1.0 // No paths to check
    }

    // Collect all file paths mentioned in template
    const preservedPaths = new Set<string>()

    // From artifacts
    template.artifacts.files_read.forEach((p) => preservedPaths.add(p))
    template.artifacts.files_modified.forEach((f) => preservedPaths.add(f.path))
    template.artifacts.files_created.forEach((p) => preservedPaths.add(p))

    // Check key_context for file path mentions
    for (const path of originalFilePaths) {
      if (template.key_context.includes(path)) {
        preservedPaths.add(path)
      }
    }

    // Calculate retention ratio
    let retained = 0
    for (const path of originalFilePaths) {
      if (preservedPaths.has(path)) {
        retained++
      }
    }

    return retained / originalFilePaths.length
  }

  /**
   * Get list of quality issues with the template
   */
  export function getIssues(template: CompactionSchema.CompactionTemplate): string[] {
    const issues: string[] = []

    // Check critical sections
    if (!template.session_intent || template.session_intent.length === 0) {
      issues.push("Missing session intent")
    }

    if (!template.current_state || template.current_state.length === 0) {
      issues.push("Missing current state")
    }

    if (!template.key_context || template.key_context.length === 0) {
      issues.push("Missing key context")
    }

    // Check for unresolved errors
    const unresolvedErrors = template.errors.filter((e) => !e.resolved)
    if (unresolvedErrors.length > 0) {
      issues.push(`${unresolvedErrors.length} unresolved error(s) in session`)
    }

    return issues
  }

  /**
   * Score compaction quality and return issues
   */
  export function scoreCompaction(
    template: CompactionSchema.CompactionTemplate,
    originalFilePaths: string[],
    config?: { threshold?: number }
  ): { score: number; issues: string[] } {
    // Calculate component scores
    const completenessScore = scoreCompleteness(template)
    const retentionScore = scoreInformationRetention(originalFilePaths, template)

    // Combined score (weighted average)
    const score = completenessScore * 0.6 + retentionScore * 0.4

    // Get issues
    const issues = getIssues(template)

    // Check threshold
    if (config?.threshold !== undefined && score < config.threshold) {
      issues.push("Quality below threshold")
    }

    return {
      score: Math.round(score * 100) / 100,
      issues,
    }
  }
}
