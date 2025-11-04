import { Config } from "../config/config"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import z from "zod"
import path from "path"

/**
 * Workflows System
 *
 * Manages predefined orchestration workflows from .opencode/workflows/ directory.
 * Workflows define step-by-step patterns for common orchestration tasks.
 *
 * Workflows provide:
 * - Reusable orchestration patterns
 * - Step-by-step task breakdowns
 * - Agent delegation strategies
 * - Validation checkpoints
 *
 * @module Workflows
 */
export namespace Workflows {
  const log = Log.create({ service: "workflows" })

  export const WorkflowStep = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    agent: z.string(), // Which agent handles this step
    parallel: z.boolean().default(false), // Can run in parallel with others
    dependencies: z.array(z.string()).default([]), // IDs of steps that must complete first
    validation: z
      .object({
        required: z.boolean().default(false),
        criteria: z.string().optional(),
      })
      .optional(),
    prompt: z.string(), // Prompt template for the agent
  })

  export const Workflow = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean().default(true),
    category: z.string().optional(), // e.g., "feature", "bugfix", "refactor"
    tags: z.array(z.string()).default([]),
    estimatedTime: z.string().optional(), // e.g., "30m", "2h"
    steps: z.array(WorkflowStep),
    metadata: z
      .object({
        author: z.string().optional(),
        version: z.string().optional(),
        created: z.string().optional(),
        updated: z.string().optional(),
      })
      .optional(),
  })

  export type Workflow = z.infer<typeof Workflow>
  export type WorkflowStep = z.infer<typeof WorkflowStep>

  const state = Instance.state(async () => {
    const workflows: Workflow[] = []
    const glob = new Bun.Glob("workflows/*.{json,yaml,yml}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        try {
          const content = await Bun.file(match).text()
          let parsed: any

          if (match.endsWith(".json")) {
            parsed = JSON.parse(content)
          } else if (match.endsWith(".yaml") || match.endsWith(".yml")) {
            // For production, use a proper YAML library
            log.warn("YAML workflows not yet supported", { file: match })
            continue
          }

          const workflow = Workflow.parse({
            id: parsed.id || path.basename(match, path.extname(match)),
            ...parsed,
          })

          if (workflow.enabled) {
            workflows.push(workflow)
            log.info("loaded workflow", { id: workflow.id, steps: workflow.steps.length })
          }
        } catch (error) {
          log.error("failed to load workflow", {
            file: match,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    return { workflows }
  })

  /**
   * Get all enabled workflows
   */
  export async function list(): Promise<Workflow[]> {
    return state().then((x) => x.workflows)
  }

  /**
   * Get a specific workflow by ID
   */
  export async function get(id: string): Promise<Workflow | undefined> {
    const { workflows } = await state()
    return workflows.find((w) => w.id === id)
  }

  /**
   * Get workflows by category
   */
  export async function getByCategory(category: string): Promise<Workflow[]> {
    const { workflows } = await state()
    return workflows.filter((w) => w.category === category)
  }

  /**
   * Get workflows by tags
   */
  export async function getByTags(tags: string[]): Promise<Workflow[]> {
    const { workflows } = await state()
    return workflows.filter((w) => tags.some((tag) => w.tags.includes(tag)))
  }

  /**
   * Generate orchestration plan from workflow
   */
  export async function generatePlan(workflowId: string): Promise<string> {
    const workflow = await get(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)

    const sections: string[] = []

    sections.push(`# Workflow: ${workflow.name}`)
    sections.push(`${workflow.description}`)

    if (workflow.estimatedTime) {
      sections.push(`\n**Estimated Time:** ${workflow.estimatedTime}`)
    }

    sections.push(`\n## Steps\n`)

    workflow.steps.forEach((step, index) => {
      sections.push(`### ${index + 1}. ${step.name}`)
      sections.push(`**Agent:** @${step.agent}`)
      sections.push(`**Description:** ${step.description}`)

      if (step.dependencies.length > 0) {
        sections.push(`**Dependencies:** ${step.dependencies.join(", ")}`)
      }

      if (step.parallel) {
        sections.push(`**Execution:** Can run in parallel`)
      }

      if (step.validation) {
        sections.push(`**Validation:** ${step.validation.required ? "Required" : "Optional"}`)
        if (step.validation.criteria) {
          sections.push(`**Criteria:** ${step.validation.criteria}`)
        }
      }

      sections.push(`\n**Prompt:**\n\`\`\`\n${step.prompt}\n\`\`\`\n`)
    })

    return sections.join("\n")
  }

  /**
   * Get execution order for workflow steps considering dependencies
   */
  export async function getExecutionOrder(workflowId: string): Promise<WorkflowStep[][]> {
    const workflow = await get(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)

    const steps = [...workflow.steps]
    const executed = new Set<string>()
    const batches: WorkflowStep[][] = []

    while (steps.length > 0) {
      const batch: WorkflowStep[] = []

      // Find steps that can execute now (dependencies met)
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]
        const dependenciesMet = step.dependencies.every((dep) => executed.has(dep))

        if (dependenciesMet) {
          batch.push(step)
          steps.splice(i, 1)
          executed.add(step.id)
        }
      }

      if (batch.length === 0 && steps.length > 0) {
        throw new Error("Circular dependency detected in workflow")
      }

      if (batch.length > 0) {
        batches.push(batch)
      }
    }

    return batches
  }
}
