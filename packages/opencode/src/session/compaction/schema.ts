import z from "zod"

export namespace CompactionSchema {
  /**
   * Represents a file modification with optional change summary
   */
  export const FileModification = z.object({
    path: z.string(),
    change_summary: z.string().optional(),
  })
  export type FileModification = z.infer<typeof FileModification>

  /**
   * Artifacts extracted deterministically from tool calls
   */
  export const Artifacts = z.object({
    files_read: z.array(z.string()),
    files_modified: z.array(FileModification),
    files_created: z.array(z.string()),
  })
  export type Artifacts = z.infer<typeof Artifacts>

  /**
   * Consolidated tool call summary
   */
  export const ToolCallSummary = z.object({
    tool: z.string(),
    summary: z.string(),
    success: z.boolean(),
  })
  export type ToolCallSummary = z.infer<typeof ToolCallSummary>

  /**
   * Error information with resolution status
   */
  export const ErrorInfo = z.object({
    message: z.string(),
    resolved: z.boolean(),
    resolution: z.string().optional(),
  })
  export type ErrorInfo = z.infer<typeof ErrorInfo>

  /**
   * A decision made during the session with rationale
   */
  export const Decision = z.object({
    decision: z.string(),
    rationale: z.string(),
  })
  export type Decision = z.infer<typeof Decision>

  /**
   * Agent context for preserving agent personality/role
   */
  export const AgentContext = z.object({
    agent_name: z.string(),
    agent_role: z.string().optional(),
    constraints: z.array(z.string()).optional(),
  })
  export type AgentContext = z.infer<typeof AgentContext>

  /**
   * Metrics about the compaction process
   */
  export const CompactionMetrics = z.object({
    original_tokens: z.number(),
    compacted_tokens: z.number(),
    compression_ratio: z.number(),
  })
  export type CompactionMetrics = z.infer<typeof CompactionMetrics>

  /**
   * Output from LLM extraction (sections extracted by LLM)
   */
  export const LLMExtractionOutput = z.object({
    session_intent: z.string(),
    current_state: z.string(),
    decisions: z.array(Decision),
    pending_tasks: z.array(z.string()),
    key_context: z.string(),
  })
  export type LLMExtractionOutput = z.infer<typeof LLMExtractionOutput>

  /**
   * The complete compaction template combining deterministic and LLM sections
   */
  export const CompactionTemplate = z.object({
    version: z.literal("1.0"),
    timestamp: z.number(),

    // Deterministic sections (extracted without LLM)
    artifacts: Artifacts,
    tool_calls: z.array(ToolCallSummary),
    errors: z.array(ErrorInfo),

    // LLM-extracted sections
    session_intent: z.string(),
    current_state: z.string(),
    decisions: z.array(Decision),
    pending_tasks: z.array(z.string()),
    key_context: z.string(),

    // Optional agent context preservation
    agent_context: AgentContext.optional(),

    // Metrics
    metrics: CompactionMetrics,
  })
  export type CompactionTemplate = z.infer<typeof CompactionTemplate>

  /**
   * Configuration options for hybrid compaction
   */
  export const HybridConfig = z.object({
    enabled: z.boolean().default(true),
    preserve_agent_context: z.boolean().default(true),
    quality_threshold: z.number().min(0).max(1).optional(),
  })
  export type HybridConfig = z.infer<typeof HybridConfig>
}
