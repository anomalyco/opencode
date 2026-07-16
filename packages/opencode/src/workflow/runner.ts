import type { ConfigWorkflowV1 } from "@opencode-ai/core/v1/config/workflow"

export interface WorkflowStep {
  readonly id: string
  readonly prompt: string
  readonly depends_on?: string | string[]
  readonly when?: string
  readonly agent?: string
  readonly model?: string
  readonly outputs?: Array<{ name: string; description?: string }>
}

export interface WorkflowDefinition {
  readonly name: string
  readonly description?: string
  readonly agent?: string
  readonly model?: string
  readonly steps: WorkflowStep[]
}

export interface StepResult {
  readonly id: string
  readonly status: "success" | "error" | "skipped"
  readonly output?: string
}

export function resolveDependencies(steps: WorkflowStep[]): WorkflowStep[][] {
  const graph = new Map<string, { step: WorkflowStep; deps: Set<string> }>()
  for (const step of steps) {
    const deps = new Set<string>()
    if (step.depends_on) {
      const depList = Array.isArray(step.depends_on) ? step.depends_on : [step.depends_on]
      for (const dep of depList) deps.add(dep)
    }
    graph.set(step.id, { step, deps })
  }

  const layers: WorkflowStep[][] = []
  const resolved = new Set<string>()

  while (resolved.size < steps.length) {
    const layer: WorkflowStep[] = []
    for (const [id, { step, deps }] of graph) {
      if (resolved.has(id)) continue
      const allDepsResolved = [...deps].every((d) => resolved.has(d))
      if (allDepsResolved) layer.push(step)
    }
    if (layer.length === 0) {
      const remaining = steps.filter((s) => !resolved.has(s.id))
      throw new Error(`Circular dependency detected in workflow steps: ${remaining.map((s) => s.id).join(", ")}`)
    }
    layers.push(layer)
    for (const step of layer) resolved.add(step.id)
  }

  return layers
}

function evaluateCondition(when: string, results: Map<string, StepResult>): boolean {
  const match = when.match(/^\$\{\{steps\.(\w+)\.output\s+contains\s+"([^"]+)"\}\}$/)
  if (match) {
    const [, stepId, expected] = match
    const result = results.get(stepId)
    if (!result || result.status !== "success" || !result.output) return false
    return result.output.includes(expected)
  }

  const statusMatch = when.match(/^\$\{\{steps\.(\w+)\.status\}\}\s*==\s*"(\w+)"$/)
  if (statusMatch) {
    const [, stepId, expectedStatus] = statusMatch
    const result = results.get(stepId)
    if (!result) return false
    return result.status === expectedStatus
  }

  return when.trim() !== ""
}

function resolveOutputReferences(prompt: string, results: Map<string, StepResult>): string {
  return prompt.replace(/\$\{\{steps\.(\w+)\.output\}\}/g, (_, stepId) => {
    const result = results.get(stepId)
    if (!result || !result.output) return `[Output from step "${stepId}" not available]`
    return result.output
  })
}

export function buildWorkflowPrompt(
  workflow: WorkflowDefinition,
  inputArguments: string,
): { prompt: string; agent?: string; model?: string } {
  const layers = resolveDependencies(workflow.steps)
  const results = new Map<string, StepResult>()

  const sections: string[] = []

  sections.push(`# Workflow: ${workflow.name}`)
  if (workflow.description) {
    sections.push(`\n${workflow.description}`)
  }
  if (inputArguments.trim()) {
    sections.push(`\nUser input: ${inputArguments}`)
  }

  sections.push("\n## Execution Plan")
  sections.push("\nExecute each step in order. For each step:")
  sections.push("1. Perform the requested action")
  sections.push("2. Report the result clearly (success/error and output)")
  sections.push("3. Continue to the next step")

  let stepNumber = 0
  for (const layer of layers) {
    for (const step of layer) {
      stepNumber++
      const resolvedPrompt = resolveOutputReferences(step.prompt, results)
      sections.push(`\n### Step ${stepNumber}: ${step.id}`)
      if (step.when) {
        const conditionMet = evaluateCondition(step.when, results)
        if (!conditionMet) {
          sections.push(`\n*Skipped (condition not met: ${step.when})*`)
          results.set(step.id, { id: step.id, status: "skipped" })
          continue
        }
      }
      sections.push(`\n${resolvedPrompt}`)
      sections.push(`\n--- Report result as: [Step ${step.id}: SUCCESS/ERROR] with brief output ---`)
      results.set(step.id, { id: step.id, status: "success", output: "" })
    }
  }

  sections.push("\n## Summary")
  sections.push("\nAfter completing all steps, provide a summary of:")
  sections.push("- Which steps succeeded/failed")
  sections.push("- Key outputs from each step")
  sections.push("- Any issues encountered")

  return {
    prompt: sections.join("\n"),
    agent: workflow.agent,
    model: workflow.model,
  }
}

export function toWorkflowDefinition(name: string, config: ConfigWorkflowV1.Info): WorkflowDefinition {
  return {
    name: config.name ?? name,
    description: config.description,
    agent: config.agent,
    model: config.model,
    steps: config.steps.map((step) => ({
      id: step.id,
      prompt: step.prompt,
      depends_on: step.depends_on ? (Array.isArray(step.depends_on) ? [...step.depends_on] : step.depends_on) : undefined,
      when: step.when,
      agent: step.agent,
      model: step.model,
      outputs: step.outputs?.map((o) => ({ ...o })),
    })),
  }
}
