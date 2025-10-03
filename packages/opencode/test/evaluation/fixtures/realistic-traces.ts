import type { Trace } from "../../../src/trace"

/**
 * Realistic trace fixtures based on actual agent behavior patterns.
 * 
 * These fixtures represent common scenarios observed in production:
 * - Successful workflows with typical tool sequences
 * - Error patterns with retries
 * - Cache utilization patterns
 * - Token usage distributions
 * - Performance characteristics
 */

const generateId = () => `trace-${Date.now()}-${Math.random()}`

function generateToolSequence(
  tools: string[],
  errorRate: number = 0
): Trace.Complete["toolCalls"] {
  return tools.map((id, index) => ({
    id,
    sessionID: "test-session",
    timestamp: Date.now() + index * 100,
    duration: Math.floor(50 + Math.random() * 300),
    status: Math.random() < errorRate ? ("error" as const) : ("success" as const),
  }))
}

export const RealisticTraces = {
  /**
   * Successful code editing workflow - most common pattern.
   * Read file → Find pattern → Edit file → Verify
   */
  successfulCodeEdit: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 8,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Successfully edited file and verified changes",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 150,
        status: "success",
      },
      {
        id: "Grep",
        sessionID: "test-session",
        timestamp: Date.now() + 150,
        duration: 89,
        status: "success",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 239,
        duration: 234,
        status: "success",
      },
      {
        id: "Execute",
        sessionID: "test-session",
        timestamp: Date.now() + 473,
        duration: 1500,
        status: "success",
      },
    ],
    summary: {
      duration: 2150,
      toolCallCount: 4,
      errorCount: 0,
      tokens: {
        input: 1250,
        output: 450,
        reasoning: 180,
        cache: { read: 800, write: 200 },
      },
      cost: 0.0245, // Realistic Claude 3.5 Sonnet pricing
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 2150,
  }),

  /**
   * Failed operation with retry - realistic error recovery pattern.
   * Shows how errors increase cost and duration.
   */
  failedWithRetry: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 12,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Completed after retrying failed operations",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 50,
        status: "error",
      },
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now() + 800, // Delay after error
        duration: 120,
        status: "success",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 920,
        duration: 45,
        status: "error",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 1700, // Delay after error
        duration: 180,
        status: "success",
      },
      {
        id: "Execute",
        sessionID: "test-session",
        timestamp: Date.now() + 1880,
        duration: 1200,
        status: "success",
      },
    ],
    summary: {
      duration: 3200,
      toolCallCount: 5,
      errorCount: 2,
      tokens: {
        input: 2100, // Higher due to retries
        output: 680,
        reasoning: 340,
        cache: { read: 400, write: 100 },
      },
      cost: 0.0520, // ~2x normal due to retries
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 3200,
  }),

  /**
   * Long-running complex task - large refactoring or multi-file change.
   * Represents 95th percentile duration scenarios.
   */
  complexRefactoring: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 15,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Refactored multiple files and verified all tests pass",
    toolCalls: generateToolSequence([
      "Grep",
      "Read",
      "Read",
      "Read",
      "Grep",
      "MultiEdit",
      "MultiEdit",
      "Execute",
      "Execute",
      "Read",
    ]),
    summary: {
      duration: 15000, // 15 seconds
      toolCallCount: 10,
      errorCount: 0,
      tokens: {
        input: 8500, // Large context for multi-file changes
        output: 2100,
        reasoning: 1200,
        cache: { read: 3000, write: 1500 },
      },
      cost: 0.1850, // Expensive due to size
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 15000,
  }),

  /**
   * Cache-heavy scenario - subsequent similar task with high cache hits.
   * Represents cost optimization from prompt caching.
   */
  cachedExecution: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 6,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Completed similar task with cached context",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 110,
        status: "success",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 110,
        duration: 180,
        status: "success",
      },
      {
        id: "Execute",
        sessionID: "test-session",
        timestamp: Date.now() + 290,
        duration: 1400,
        status: "success",
      },
    ],
    summary: {
      duration: 1800,
      toolCallCount: 3,
      errorCount: 0,
      tokens: {
        input: 500, // Much lower input
        output: 300,
        reasoning: 100,
        cache: { read: 4000, write: 50 }, // High cache reads
      },
      cost: 0.0089, // ~3x cheaper due to caching
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 1800,
  }),

  /**
   * Deep reasoning task - minimal tools, high reasoning tokens.
   * Represents complex problem-solving or planning phases.
   */
  deepReasoning: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 10,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Analyzed codebase and created implementation plan",
    toolCalls: [
      {
        id: "Grep",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 150,
        status: "success",
      },
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now() + 150,
        duration: 200,
        status: "success",
      },
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now() + 350,
        duration: 180,
        status: "success",
      },
    ],
    summary: {
      duration: 4500,
      toolCallCount: 3,
      errorCount: 0,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 5000, // High reasoning for analysis
        cache: { read: 200, write: 100 },
      },
      cost: 0.0680, // Expensive due to reasoning tokens
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 4500,
  }),

  /**
   * Quick fix - minimal operation, low cost.
   * Represents simple, well-defined tasks.
   */
  quickFix: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 4,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Fixed typo in documentation",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 80,
        status: "success",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 80,
        duration: 120,
        status: "success",
      },
    ],
    summary: {
      duration: 600,
      toolCallCount: 2,
      errorCount: 0,
      tokens: {
        input: 300,
        output: 100,
        reasoning: 20,
        cache: { read: 150, write: 50 },
      },
      cost: 0.0045, // Very cheap
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 600,
  }),

  /**
   * High error rate - debugging or difficult task.
   * Shows worst-case scenario with multiple failures.
   */
  highErrorRate: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 20,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Eventually succeeded after multiple attempts",
    toolCalls: generateToolSequence(
      ["Execute", "Execute", "Execute", "Edit", "Execute", "Execute"],
      0.5 // 50% error rate
    ),
    summary: {
      duration: 8000,
      toolCallCount: 6,
      errorCount: 3,
      tokens: {
        input: 3500,
        output: 1200,
        reasoning: 600,
        cache: { read: 500, write: 200 },
      },
      cost: 0.0890,
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 8000,
  }),

  /**
   * Haiku model - faster, cheaper alternative.
   * Lower quality but good for simple tasks.
   */
  haikuModel: (): Trace.Complete => ({
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 5,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    },
    output: "Completed with Haiku model",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 60,
        status: "success",
      },
      {
        id: "Edit",
        sessionID: "test-session",
        timestamp: Date.now() + 60,
        duration: 90,
        status: "success",
      },
    ],
    summary: {
      duration: 400, // Much faster
      toolCallCount: 2,
      errorCount: 0,
      tokens: {
        input: 400,
        output: 150,
        reasoning: 0, // No reasoning tokens in Haiku
        cache: { read: 200, write: 50 },
      },
      cost: 0.0018, // Much cheaper
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 400,
  }),

  /**
   * Create a customized trace with specific overrides.
   * Useful for testing specific scenarios.
   */
  custom: (overrides: Partial<Trace.Complete>): Trace.Complete => ({
    ...RealisticTraces.successfulCodeEdit(),
    ...overrides,
  }),

  /**
   * Generate multiple traces with variation.
   * Adds realistic noise to base patterns.
   */
  generateVariations: (
    baseGenerator: () => Trace.Complete,
    count: number,
    variance: number = 0.1
  ): Trace.Complete[] => {
    return Array.from({ length: count }, () => {
      const base = baseGenerator()
      const costVariation = 1 + (Math.random() * variance * 2 - variance)
      const durationVariation = 1 + (Math.random() * variance * 2 - variance)

      return {
        ...base,
        id: generateId(),
        summary: {
          ...base.summary,
          cost: base.summary.cost * costVariation,
          duration: Math.floor(base.summary.duration * durationVariation),
        },
        createdAt: Date.now() + Math.random() * 1000,
        completedAt: Date.now() + Math.random() * 1000 + base.summary.duration,
      }
    })
  },
}
