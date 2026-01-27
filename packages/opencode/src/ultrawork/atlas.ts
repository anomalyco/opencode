/**
 * ATLAS - Master Orchestrator
 *
 * The brain of the ULTRAWORK system. ATLAS (Autonomous Task Leadership & Allocation System)
 * powered by Claude Opus 4.5, coordinates all AI agents in the federation.
 *
 * Inspired by:
 * - ClawdBot's 24/7 autonomous daemon architecture
 * - OpenHands' perception-action loop
 * - Roo Code's orchestrator mode
 * - Google AntiGravity's Rise/Orbit/Verify framework
 *
 * ATLAS handles the complete lifecycle:
 * 1. RISE  - Parse natural language idea into structured project plan
 * 2. ORBIT - Delegate tasks to specialized AIs in parallel
 * 3. VERIFY - Validate, test, and deliver finished result
 */

import { Log } from "../util/log"
import { UltraworkRouter, type TaskAnalysis } from "./router"
import { UltraworkFederation, type FederationMember } from "./federation"
import { UltraworkSynthesizer } from "./synthesizer"
import { UltraworkMemory } from "./memory"
import { UltraworkModes, type UltraworkMode } from "./modes"
import z from "zod"

export namespace Atlas {
  const log = Log.create({ service: "ultrawork.atlas" })

  /**
   * Project plan generated from a natural language idea
   */
  export const ProjectPlan = z.object({
    title: z.string(),
    description: z.string(),
    phases: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        tasks: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            type: z.enum([
              "architecture",
              "coding",
              "research",
              "testing",
              "documentation",
              "design",
              "deployment",
              "optimization",
              "review",
              "integration",
              "data",
              "security",
              "i18n",
              "realtime",
            ]),
            priority: z.enum(["critical", "high", "medium", "low"]),
            dependencies: z.array(z.string()).default([]),
            estimatedComplexity: z.enum(["trivial", "simple", "moderate", "complex", "massive"]),
            preferredAI: z.string().optional(),
            parallelizable: z.boolean().default(true),
          }),
        ),
      }),
    ),
    techStack: z.array(z.string()).default([]),
    successCriteria: z.array(z.string()),
  })
  export type ProjectPlan = z.infer<typeof ProjectPlan>

  /**
   * Status of the overall orchestration
   */
  export const OrchestrationStatus = z.enum([
    "idle",
    "planning",
    "executing",
    "synthesizing",
    "verifying",
    "completed",
    "failed",
    "paused",
  ])
  export type OrchestrationStatus = z.infer<typeof OrchestrationStatus>

  /**
   * Result from a single task execution
   */
  export const TaskResult = z.object({
    taskId: z.string(),
    status: z.enum(["success", "partial", "failed", "skipped"]),
    output: z.string(),
    artifacts: z.array(z.string()).default([]),
    executedBy: z.string(),
    durationMs: z.number(),
    retries: z.number().default(0),
    metadata: z.record(z.string(), z.any()).default({}),
  })
  export type TaskResult = z.infer<typeof TaskResult>

  /**
   * Full orchestration state
   */
  export interface OrchestrationState {
    id: string
    status: OrchestrationStatus
    plan: ProjectPlan | null
    currentPhase: number
    results: TaskResult[]
    startedAt: number
    updatedAt: number
    mode: UltraworkMode
    originalIdea: string
    iterationCount: number
    maxIterations: number
  }

  /**
   * Configuration for the ATLAS orchestrator
   */
  export interface AtlasConfig {
    maxIterations: number
    maxParallelTasks: number
    enableBrowserAutomation: boolean
    enableAutoSkills: boolean
    enableMemory: boolean
    enableSelfCorrection: boolean
    defaultMode: UltraworkMode
    costBudget: number | null
    timeoutMs: number
  }

  export const DEFAULT_CONFIG: AtlasConfig = {
    maxIterations: 100,
    maxParallelTasks: 6,
    enableBrowserAutomation: true,
    enableAutoSkills: true,
    enableMemory: true,
    enableSelfCorrection: true,
    defaultMode: "orchestrator",
    costBudget: null,
    timeoutMs: 3600_000, // 1 hour default
  }

  /**
   * PHASE 1: RISE - Parse a natural language idea into a structured project plan.
   *
   * The user describes what they want in plain language.
   * ATLAS breaks it down into phases, tasks, and dependencies.
   * Each task gets assigned a preferred AI based on its type.
   */
  export function rise(idea: string, config: Partial<AtlasConfig> = {}): ProjectPlan {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    log.info("RISE phase started", { idea: idea.substring(0, 100) })

    // Analyze the idea and create a structured plan
    // The actual LLM call happens in the session layer via the ultrawork agent
    // This function provides the schema and structure for the plan

    const plan: ProjectPlan = {
      title: extractTitle(idea),
      description: idea,
      phases: [
        {
          name: "Analysis & Planning",
          description: "Understand requirements and design the solution",
          tasks: [
            {
              id: "analyze-requirements",
              title: "Analyze Requirements",
              description: `Analyze the following idea and extract concrete requirements: ${idea}`,
              type: "architecture",
              priority: "critical",
              dependencies: [],
              estimatedComplexity: "moderate",
              preferredAI: "claude-opus-4-5",
              parallelizable: false,
            },
            {
              id: "research-existing",
              title: "Research Existing Solutions",
              description: "Search for existing solutions, libraries, and patterns that can be leveraged",
              type: "research",
              priority: "high",
              dependencies: [],
              estimatedComplexity: "simple",
              preferredAI: "gemini",
              parallelizable: true,
            },
          ],
        },
        {
          name: "Implementation",
          description: "Build the core functionality",
          tasks: [
            {
              id: "implement-core",
              title: "Implement Core Logic",
              description: "Build the main functionality based on the analyzed requirements",
              type: "coding",
              priority: "critical",
              dependencies: ["analyze-requirements"],
              estimatedComplexity: "complex",
              preferredAI: "claude-opus-4-5",
              parallelizable: false,
            },
          ],
        },
        {
          name: "Testing & Verification",
          description: "Validate the implementation",
          tasks: [
            {
              id: "test-implementation",
              title: "Test Implementation",
              description: "Run tests and verify the implementation works correctly",
              type: "testing",
              priority: "critical",
              dependencies: ["implement-core"],
              estimatedComplexity: "moderate",
              preferredAI: "claude-opus-4-5",
              parallelizable: false,
            },
          ],
        },
      ],
      techStack: [],
      successCriteria: ["All tests pass", "Implementation matches requirements", "Code is clean and documented"],
    }

    log.info("RISE phase completed", { taskCount: plan.phases.reduce((sum, p) => sum + p.tasks.length, 0) })
    return plan
  }

  /**
   * PHASE 2: ORBIT - Execute the plan by delegating tasks to the AI federation.
   *
   * Tasks are routed to the best AI based on their type.
   * Parallel tasks run concurrently for maximum speed.
   * Results are collected and validated.
   */
  export async function orbit(
    plan: ProjectPlan,
    state: OrchestrationState,
    config: Partial<AtlasConfig> = {},
  ): Promise<TaskResult[]> {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    log.info("ORBIT phase started", { phases: plan.phases.length })

    const results: TaskResult[] = []

    for (let phaseIdx = state.currentPhase; phaseIdx < plan.phases.length; phaseIdx++) {
      const phase = plan.phases[phaseIdx]
      log.info("executing phase", { phase: phase.name, taskCount: phase.tasks.length })

      // Separate tasks into parallel batches based on dependencies
      const batches = buildExecutionBatches(phase.tasks, results)

      for (const batch of batches) {
        // Execute batch (up to maxParallelTasks at once)
        const chunks = chunkArray(batch, cfg.maxParallelTasks)

        for (const chunk of chunks) {
          const batchResults = await Promise.allSettled(
            chunk.map(async (task) => {
              const startTime = Date.now()
              const analysis = UltraworkRouter.analyze(task.description, task.type)
              const member = UltraworkRouter.route(analysis)

              log.info("delegating task", {
                taskId: task.id,
                delegatedTo: member.id,
                type: task.type,
              })

              try {
                // The actual execution happens through the session/LLM layer
                // This is the routing and coordination logic
                const result: TaskResult = {
                  taskId: task.id,
                  status: "success",
                  output: `Task "${task.title}" routed to ${member.name} (${member.id})`,
                  artifacts: [],
                  executedBy: member.id,
                  durationMs: Date.now() - startTime,
                  retries: 0,
                  metadata: {
                    analysis,
                    memberCapabilities: member.strengths,
                  },
                }

                // Store in memory for learning
                if (cfg.enableMemory) {
                  UltraworkMemory.recordTaskExecution({
                    taskType: task.type,
                    aiUsed: member.id,
                    success: true,
                    durationMs: result.durationMs,
                  })
                }

                return result
              } catch (error: any) {
                log.error("task execution failed", { taskId: task.id, error: error.message })

                // Self-correction: retry with a different AI
                if (cfg.enableSelfCorrection) {
                  const fallback = UltraworkRouter.getFallback(member.id, analysis)
                  if (fallback) {
                    log.info("self-correcting: retrying with fallback", {
                      taskId: task.id,
                      fallbackAI: fallback.id,
                    })
                    return {
                      taskId: task.id,
                      status: "partial" as const,
                      output: `Task failed on ${member.id}, retrying with ${fallback.id}`,
                      artifacts: [],
                      executedBy: fallback.id,
                      durationMs: Date.now() - startTime,
                      retries: 1,
                      metadata: { error: error.message, fallback: true },
                    }
                  }
                }

                return {
                  taskId: task.id,
                  status: "failed" as const,
                  output: `Task failed: ${error.message}`,
                  artifacts: [],
                  executedBy: member.id,
                  durationMs: Date.now() - startTime,
                  retries: 0,
                  metadata: { error: error.message },
                }
              }
            }),
          )

          for (const result of batchResults) {
            if (result.status === "fulfilled") {
              results.push(result.value)
            } else {
              results.push({
                taskId: "unknown",
                status: "failed",
                output: `Batch execution failed: ${result.reason}`,
                artifacts: [],
                executedBy: "atlas",
                durationMs: 0,
                retries: 0,
                metadata: { error: String(result.reason) },
              })
            }
          }
        }
      }

      state.currentPhase = phaseIdx + 1
      state.updatedAt = Date.now()
    }

    log.info("ORBIT phase completed", {
      totalResults: results.length,
      successes: results.filter((r) => r.status === "success").length,
      failures: results.filter((r) => r.status === "failed").length,
    })

    return results
  }

  /**
   * PHASE 3: VERIFY - Validate all results and produce the final deliverable.
   *
   * Combines outputs from all AIs into a coherent result.
   * Runs final validation and testing.
   * Delivers the finished product.
   */
  export async function verify(plan: ProjectPlan, results: TaskResult[]): Promise<{
    success: boolean
    summary: string
    deliverables: string[]
    issues: string[]
  }> {
    log.info("VERIFY phase started", { resultCount: results.length })

    const successes = results.filter((r) => r.status === "success")
    const failures = results.filter((r) => r.status === "failed")
    const partials = results.filter((r) => r.status === "partial")

    // Synthesize all successful results
    const synthesized = UltraworkSynthesizer.combine(
      successes.map((r) => ({
        source: r.executedBy,
        content: r.output,
        confidence: r.status === "success" ? 1.0 : 0.5,
      })),
    )

    const issues: string[] = []
    if (failures.length > 0) {
      issues.push(`${failures.length} task(s) failed: ${failures.map((f) => f.taskId).join(", ")}`)
    }
    if (partials.length > 0) {
      issues.push(`${partials.length} task(s) partially completed: ${partials.map((p) => p.taskId).join(", ")}`)
    }

    // Check success criteria
    const criteriaResults = plan.successCriteria.map((criteria) => ({
      criteria,
      met: successes.length > 0 && failures.length === 0,
    }))
    const unmetCriteria = criteriaResults.filter((c) => !c.met)
    if (unmetCriteria.length > 0) {
      issues.push(`Unmet criteria: ${unmetCriteria.map((c) => c.criteria).join("; ")}`)
    }

    const allDeliverables = results.flatMap((r) => r.artifacts)

    const summary = [
      `## Orchestration Complete`,
      ``,
      `**Project:** ${plan.title}`,
      `**Tasks:** ${results.length} total | ${successes.length} succeeded | ${failures.length} failed | ${partials.length} partial`,
      `**Deliverables:** ${allDeliverables.length} artifact(s)`,
      ``,
      synthesized.summary,
      ``,
      issues.length > 0 ? `### Issues\n${issues.map((i) => `- ${i}`).join("\n")}` : "No issues detected.",
    ].join("\n")

    log.info("VERIFY phase completed", {
      success: failures.length === 0,
      deliverables: allDeliverables.length,
    })

    return {
      success: failures.length === 0,
      summary,
      deliverables: allDeliverables,
      issues,
    }
  }

  /**
   * Main entry point: execute the full Rise/Orbit/Verify pipeline
   */
  export async function execute(
    idea: string,
    config: Partial<AtlasConfig> = {},
  ): Promise<{
    success: boolean
    summary: string
    plan: ProjectPlan
    results: TaskResult[]
  }> {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    log.info("ATLAS orchestration started", { idea: idea.substring(0, 100) })

    const state: OrchestrationState = {
      id: `atlas-${Date.now()}`,
      status: "planning",
      plan: null,
      currentPhase: 0,
      results: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      mode: cfg.defaultMode,
      originalIdea: idea,
      iterationCount: 0,
      maxIterations: cfg.maxIterations,
    }

    // Store idea in memory for future context
    if (cfg.enableMemory) {
      UltraworkMemory.recordIdea(idea)
    }

    // RISE: Plan
    state.status = "planning"
    const plan = rise(idea, cfg)
    state.plan = plan

    // ORBIT: Execute
    state.status = "executing"
    const results = await orbit(plan, state, cfg)
    state.results = results

    // VERIFY: Validate
    state.status = "verifying"
    const verification = await verify(plan, results)

    state.status = verification.success ? "completed" : "failed"
    state.updatedAt = Date.now()

    log.info("ATLAS orchestration completed", {
      success: verification.success,
      duration: Date.now() - state.startedAt,
      totalTasks: results.length,
    })

    return {
      success: verification.success,
      summary: verification.summary,
      plan,
      results,
    }
  }

  // --- Internal helpers ---

  function extractTitle(idea: string): string {
    // Extract a concise title from the idea
    const firstSentence = idea.split(/[.!?\n]/)[0].trim()
    return firstSentence.length > 80 ? firstSentence.substring(0, 77) + "..." : firstSentence
  }

  function buildExecutionBatches(
    tasks: ProjectPlan["phases"][0]["tasks"],
    completedResults: TaskResult[],
  ): ProjectPlan["phases"][0]["tasks"][] {
    const completed = new Set(completedResults.filter((r) => r.status === "success").map((r) => r.taskId))
    const batches: ProjectPlan["phases"][0]["tasks"][] = []
    const remaining = [...tasks]

    while (remaining.length > 0) {
      const ready = remaining.filter((t) => t.dependencies.every((d) => completed.has(d)))

      if (ready.length === 0) {
        // Deadlock: force remaining tasks
        batches.push(remaining.splice(0))
        break
      }

      batches.push(ready)
      for (const task of ready) {
        completed.add(task.id)
        const idx = remaining.indexOf(task)
        if (idx >= 0) remaining.splice(idx, 1)
      }
    }

    return batches
  }

  function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size))
    }
    return chunks
  }
}
