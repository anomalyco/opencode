import type { MessageV2 } from "../message-v2"
import { DeterministicExtractor } from "./extractors"
import { LLMExtractor } from "./llm-extractor"
import { QualityScorer } from "./quality"
import type { CompactionSchema } from "./schema"

/**
 * Hybrid compaction pipeline that combines deterministic extraction with LLM.
 *
 * Flow:
 * 1. Deterministic extraction (files, errors, tool calls)
 * 2. Context condensation
 * 3. LLM extraction with condensed context
 * 4. Template assembly
 * 5. Quality validation
 */
export namespace HybridCompactionPipeline {
  /**
   * Chars per token for rough estimation
   */
  const CHARS_PER_TOKEN = 4

  /**
   * Default number of recent messages to include for LLM context
   */
  const DEFAULT_RECENT_MESSAGES = 10

  /**
   * Result of deterministic extraction phase
   */
  export interface DeterministicResult {
    artifacts: CompactionSchema.Artifacts
    errors: Array<{ message: string; resolved: boolean }>
    toolCalls: Array<{ tool: string; summary: string; success: boolean }>
    condensedContext: string
  }

  /**
   * Run the deterministic extraction phase
   */
  export function runDeterministicPhase(messages: MessageV2.WithParts[]): DeterministicResult {
    // Extract structured data
    const artifacts = DeterministicExtractor.extractFiles(messages)
    const errors = DeterministicExtractor.extractErrors(messages)
    const toolCalls = DeterministicExtractor.extractToolCalls(messages)

    // Create condensed context for LLM
    const condensedContext = DeterministicExtractor.condenseContext(artifacts, errors, toolCalls)

    return {
      artifacts,
      errors,
      toolCalls,
      condensedContext,
    }
  }

  /**
   * Estimate token count from messages
   */
  export function estimateTokens(messages: MessageV2.WithParts[]): number {
    let total = 0

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "text") {
          total += (part.text?.length || 0) / CHARS_PER_TOKEN
        } else if (part.type === "tool" && part.state.status === "completed") {
          total += (part.state.output?.length || 0) / CHARS_PER_TOKEN
        }
      }
    }

    return Math.round(total)
  }

  /**
   * Assemble the final template from extraction results
   */
  export function assembleTemplate(
    deterministicResult: DeterministicResult,
    llmResult: CompactionSchema.LLMExtractionOutput,
    options: {
      originalTokens: number
      agentContext?: CompactionSchema.AgentContext
    }
  ): CompactionSchema.CompactionTemplate {
    const template: CompactionSchema.CompactionTemplate = {
      version: "1.0",
      timestamp: Date.now(),

      // Deterministic sections
      artifacts: deterministicResult.artifacts,
      tool_calls: deterministicResult.toolCalls,
      errors: deterministicResult.errors,

      // LLM sections
      session_intent: llmResult.session_intent,
      current_state: llmResult.current_state,
      decisions: llmResult.decisions,
      pending_tasks: llmResult.pending_tasks,
      key_context: llmResult.key_context,

      // Optional agent context
      agent_context: options.agentContext,

      // Metrics (compacted tokens calculated after serialization)
      metrics: {
        original_tokens: options.originalTokens,
        compacted_tokens: 0,
        compression_ratio: 0,
      },
    }

    // Calculate compacted tokens
    const text = templateToText(template)
    template.metrics.compacted_tokens = Math.round(text.length / CHARS_PER_TOKEN)
    template.metrics.compression_ratio =
      options.originalTokens > 0
        ? 1 - template.metrics.compacted_tokens / options.originalTokens
        : 0

    return template
  }

  /**
   * Convert template to human-readable text format
   */
  export function templateToText(template: CompactionSchema.CompactionTemplate): string {
    const lines: string[] = [
      "# Session Compaction",
      `Generated: ${new Date(template.timestamp).toISOString()}`,
      "",
      "## Session Intent",
      template.session_intent || "Not specified",
      "",
      "## Artifacts",
      "",
      "### Files Read",
      template.artifacts.files_read.length > 0
        ? template.artifacts.files_read.map((f) => `- ${f}`).join("\n")
        : "None",
      "",
      "### Files Modified",
      template.artifacts.files_modified.length > 0
        ? template.artifacts.files_modified
            .map((f) => `- ${f.path}${f.change_summary ? `: ${f.change_summary}` : ""}`)
            .join("\n")
        : "None",
      "",
      "### Files Created",
      template.artifacts.files_created.length > 0
        ? template.artifacts.files_created.map((f) => `- ${f}`).join("\n")
        : "None",
      "",
      "## Tool Usage Summary",
      template.tool_calls.length > 0
        ? template.tool_calls.map((t) => `- ${t.tool}: ${t.summary} (${t.success ? "✓" : "✗"})`).join("\n")
        : "None",
      "",
      "## Errors Encountered",
      template.errors.length > 0
        ? template.errors.map((e) => `- ${e.resolved ? "✓ RESOLVED" : "⚠ UNRESOLVED"}: ${e.message}`).join("\n")
        : "None",
      "",
      "## Decisions Made",
      template.decisions.length > 0
        ? template.decisions.map((d) => `- ${d.decision}${d.rationale ? `: ${d.rationale}` : ""}`).join("\n")
        : "None recorded",
      "",
      "## Current State",
      template.current_state || "Not specified",
      "",
      "## Pending Tasks",
      template.pending_tasks.length > 0
        ? template.pending_tasks.map((t) => `- [ ] ${t}`).join("\n")
        : "None",
      "",
      "## Key Context",
      template.key_context || "None",
    ]

    // Add agent context if present
    if (template.agent_context) {
      lines.push(
        "",
        "## Agent Context",
        `- Agent: ${template.agent_context.agent_name}`,
        `- Role: ${template.agent_context.agent_role || "Not specified"}`,
        template.agent_context.constraints && template.agent_context.constraints.length > 0
          ? `- Constraints: ${template.agent_context.constraints.join("; ")}`
          : ""
      )
    }

    // Add metrics
    lines.push(
      "",
      "---",
      `Compression: ${(template.metrics.compression_ratio * 100).toFixed(1)}%`,
      `(${template.metrics.original_tokens} → ${template.metrics.compacted_tokens} tokens)`
    )

    return lines.filter((l) => l !== undefined).join("\n")
  }

  /**
   * Build prompt for LLM extraction using condensed context
   */
  export function buildLLMPrompt(
    condensedContext: string,
    messages: MessageV2.WithParts[],
    recentMessageCount: number = DEFAULT_RECENT_MESSAGES
  ): string {
    const recentContext = LLMExtractor.messagesToRecentContext(messages, recentMessageCount)
    return LLMExtractor.buildPrompt(condensedContext, recentContext)
  }

  /**
   * Run quality validation on the template
   */
  export function validateQuality(
    template: CompactionSchema.CompactionTemplate,
    originalFilePaths: string[],
    threshold?: number
  ): { score: number; issues: string[]; passed: boolean } {
    const result = QualityScorer.scoreCompaction(template, originalFilePaths, { threshold })
    return {
      ...result,
      passed: threshold === undefined || result.score >= threshold,
    }
  }
}
