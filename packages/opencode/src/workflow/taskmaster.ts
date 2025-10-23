/**
 * TaskMaster AI - PRD Parser and Task Breakdown Generator
 *
 * This component uses AI to parse Product Requirements Documents (PRDs)
 * and decompose them into structured, executable tasks with dependencies.
 */

import { Provider } from "../provider/provider.js"
import { generateText } from "ai"
import { ulid } from "ulid"
import type {
  TaskBreakdown,
  Task,
  ValidationResult,
  TaskMasterConfig,
  WorkflowStage,
} from "./types.js"

export namespace TaskMaster {
  /**
   * Parse a PRD and generate a structured task breakdown
   */
  export async function parsePRD(
    prd: string,
    config?: TaskMasterConfig
  ): Promise<TaskBreakdown> {
    const model = await getModel(config)

    const prompt = buildPRDParsingPrompt(prd)

    const result = await generateText({
      model,
      prompt,
      temperature: config?.temperature ?? 0.3,
      maxTokens: config?.maxTokens ?? 4000,
    })

    const breakdown = parseTaskBreakdownFromResponse(result.text)

    return breakdown
  }

  /**
   * Validate task breakdown for consistency and completeness
   */
  export function validateTasks(tasks: Omit<Task, "id" | "workflowID" | "time">[]): ValidationResult {
    const errors: ValidationResult["errors"] = []
    const warnings: ValidationResult["warnings"] = []

    // Build a map of task titles for dependency validation
    const taskTitles = new Set(tasks.map(t => t.title))

    for (const task of tasks) {
      // Validate required fields
      if (!task.title || task.title.trim().length === 0) {
        errors.push({
          field: "title",
          message: "Task title is required",
        })
      }

      if (!task.description || task.description.trim().length === 0) {
        errors.push({
          field: "description",
          message: "Task description is required",
        })
      }

      if (!task.stage) {
        errors.push({
          field: "stage",
          message: "Task stage must be specified",
        })
      }

      // Validate dependencies exist
      for (const dep of task.dependencies) {
        if (!taskTitles.has(dep)) {
          errors.push({
            field: "dependencies",
            message: `Dependency "${dep}" does not exist in task list`,
          })
        }
      }

      // Validate estimated time is positive
      if (task.estimatedTime <= 0) {
        warnings.push({
          field: "estimatedTime",
          message: "Estimated time should be positive",
        })
      }

      // Validate priority is reasonable
      if (task.priority < 0 || task.priority > 10) {
        warnings.push({
          field: "priority",
          message: "Priority should be between 0 and 10",
        })
      }

      // Warn about circular dependencies
      if (hasSelfDependency(task, tasks)) {
        errors.push({
          field: "dependencies",
          message: `Task "${task.title}" has circular dependency`,
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Optimize task order based on dependencies and priorities
   */
  export function optimizeTaskOrder(
    tasks: Omit<Task, "id" | "workflowID" | "time">[]
  ): Omit<Task, "id" | "workflowID" | "time">[] {
    const taskMap = new Map(tasks.map(t => [t.title, t]))
    const sorted: typeof tasks = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    function visit(taskTitle: string) {
      if (visited.has(taskTitle)) return
      if (visiting.has(taskTitle)) {
        // Circular dependency, skip
        return
      }

      visiting.add(taskTitle)
      const task = taskMap.get(taskTitle)
      if (!task) return

      // Visit dependencies first
      for (const dep of task.dependencies) {
        visit(dep)
      }

      visiting.delete(taskTitle)
      visited.add(taskTitle)
      sorted.push(task)
    }

    // Sort by priority first
    const prioritySorted = [...tasks].sort((a, b) => b.priority - a.priority)

    // Then perform topological sort
    for (const task of prioritySorted) {
      visit(task.title)
    }

    return sorted
  }

  /**
   * Build the prompt for PRD parsing
   */
  function buildPRDParsingPrompt(prd: string): string {
    return `You are TaskMaster AI, an expert at analyzing Product Requirements Documents (PRDs) and breaking them down into actionable tasks.

Your job is to:
1. Carefully read and understand the PRD
2. Break it down into concrete, executable tasks
3. Identify dependencies between tasks
4. Assign each task to the appropriate workflow stage
5. Estimate time and complexity

The workflow has 4 stages:
- planning: Analysis and design work
- coding: Implementation tasks
- testing: Testing and quality assurance
- deployment: Deployment and release tasks

Output your analysis in the following JSON format:

\`\`\`json
{
  "title": "Brief title for the overall feature/project",
  "description": "One-sentence description",
  "complexity": "low|medium|high",
  "estimatedDuration": <total minutes>,
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed task description",
      "stage": "planning|coding|testing|deployment",
      "dependencies": ["Task title of dependencies"],
      "estimatedTime": <minutes>,
      "priority": <0-10, higher is more important>,
      "metadata": {
        "files": ["list of files to create/modify"],
        "risks": ["potential risks or challenges"]
      }
    }
  ]
}
\`\`\`

Important guidelines:
- Be specific and actionable in task descriptions
- Break large tasks into smaller sub-tasks
- Identify all dependencies correctly
- Estimate time realistically (consider complexity)
- Assign appropriate priorities (critical path items should have higher priority)
- Include metadata about files to modify and potential risks

Here is the PRD to analyze:

---
${prd}
---

Provide your task breakdown in JSON format:`
  }

  /**
   * Parse the AI response into a TaskBreakdown
   */
  function parseTaskBreakdownFromResponse(response: string): TaskBreakdown {
    // Extract JSON from markdown code block if present
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                     response.match(/```\s*([\s\S]*?)\s*```/)

    const jsonStr = jsonMatch ? jsonMatch[1] : response

    try {
      const parsed = JSON.parse(jsonStr)

      // Ensure all required fields are present
      const breakdown: TaskBreakdown = {
        title: parsed.title || "Untitled Workflow",
        description: parsed.description || "",
        complexity: parsed.complexity || "medium",
        estimatedDuration: parsed.estimatedDuration || 0,
        tasks: (parsed.tasks || []).map((t: any) => ({
          title: t.title || "Untitled Task",
          description: t.description || "",
          stage: (t.stage || "coding") as WorkflowStage,
          status: "pending" as const,
          dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
          estimatedTime: t.estimatedTime || 30,
          priority: t.priority ?? 5,
          metadata: t.metadata || {},
        })),
      }

      return breakdown
    } catch (error) {
      console.error("Failed to parse TaskMaster response:", error)
      console.error("Response was:", jsonStr)

      // Return a fallback breakdown
      return {
        title: "Failed to Parse PRD",
        description: "Unable to parse the PRD. Please try again.",
        complexity: "high",
        estimatedDuration: 0,
        tasks: [],
      }
    }
  }

  /**
   * Get the AI model for TaskMaster
   */
  async function getModel(config?: TaskMasterConfig) {
    const providerID = config?.model?.providerID || "anthropic"
    const modelID = config?.model?.modelID || "claude-sonnet-4"

    const result = await Provider.getModel(providerID, modelID)
    return result.language
  }


  /**
   * Check if a task has a circular dependency
   */
  function hasSelfDependency(
    task: Omit<Task, "id" | "workflowID" | "time">,
    allTasks: Omit<Task, "id" | "workflowID" | "time">[]
  ): boolean {
    const visited = new Set<string>()
    const taskMap = new Map(allTasks.map(t => [t.title, t]))

    function checkDependency(currentTitle: string, targetTitle: string): boolean {
      if (currentTitle === targetTitle) return true
      if (visited.has(currentTitle)) return false

      visited.add(currentTitle)
      const currentTask = taskMap.get(currentTitle)
      if (!currentTask) return false

      for (const dep of currentTask.dependencies) {
        if (checkDependency(dep, targetTitle)) return true
      }

      return false
    }

    for (const dep of task.dependencies) {
      if (checkDependency(dep, task.title)) {
        return true
      }
    }

    return false
  }

  /**
   * Create tasks from a task breakdown and workflow ID
   */
  export function createTasksFromBreakdown(
    workflowID: string,
    breakdown: TaskBreakdown
  ): Task[] {
    const now = Date.now()

    return breakdown.tasks.map(taskTemplate => ({
      id: ulid(),
      workflowID,
      ...taskTemplate,
      status: "pending" as const,
      time: {
        created: now,
      },
    }))
  }
}
