/**
 * Workflow Task Executor
 *
 * Executes workflow tasks by running specialized agents.
 * This is the core execution engine that bridges the orchestrator
 * and the agent system.
 */

import { Provider } from "../provider/provider.js"
import { generateText } from "ai"
import { Orchestrator } from "./orchestrator.js"
import { Workspace } from "./workspace.js"
import { getAgentForStage } from "./agents.js"
import { Log } from "../util/log.js"
import type {
  WorkflowInstance,
  Task,
  WorkflowStage,
} from "./types.js"

const log = Log.create({ service: "executor" })

export namespace Executor {
  /**
   * Execute a single task
   */
  export async function executeTask(params: {
    workflowID: string
    taskID: string
  }): Promise<void> {
    const { workflowID, taskID } = params

    log.info("Executing task", { workflowID, taskID })

    const workflow = await Orchestrator.getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    const task = workflow.tasks.find((t) => t.id === taskID)
    if (!task) {
      throw new Error(`Task ${taskID} not found`)
    }

    // Get the appropriate agent for this stage
    const agentConfig = getAgentForStage(task.stage)
    if (!agentConfig) {
      throw new Error(`No agent found for stage ${task.stage}`)
    }

    // Start the task
    await Orchestrator.startTask({
      workflowID,
      taskID,
      agentID: agentConfig.name,
    })

    try {
      // Get the AI model
      const model = await getModelForAgent(agentConfig)

      // Build the task execution prompt
      const prompt = buildTaskPrompt(workflow, task, agentConfig)

      log.info("Running agent for task", {
        workflowID,
        taskID,
        agent: agentConfig.name,
        stage: task.stage,
      })

      // Execute the task using the agent's prompt
      const result = await generateText({
        model,
        prompt,
        temperature: agentConfig.temperature ?? 0.5,
        maxSteps: 100,
      })

      log.info("Task execution completed", {
        workflowID,
        taskID,
        usage: result.usage,
      })

      // Mark task as completed
      await Orchestrator.completeTask({
        workflowID,
        taskID,
        success: true,
        metadata: {
          agentID: agentConfig.name,
          outputLength: result.text.length,
          usage: result.usage,
        },
      })

      log.info("Task marked as completed", { workflowID, taskID })
    } catch (error) {
      log.error("Task execution failed", {
        workflowID,
        taskID,
        error,
      })

      // Mark task as failed
      await Orchestrator.completeTask({
        workflowID,
        taskID,
        success: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })

      throw error
    }
  }

  /**
   * Process all pending tasks in the current stage
   */
  export async function processPendingTasks(workflowID: string): Promise<void> {
    const workflow = await Orchestrator.getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    if (workflow.status !== "running") {
      log.info("Workflow not running, skipping", {
        workflowID,
        status: workflow.status,
      })
      return
    }

    // Get pending tasks in current stage
    const pendingTasks = workflow.tasks.filter(
      (t) => t.stage === workflow.currentStage && t.status === "pending"
    )

    if (pendingTasks.length === 0) {
      log.info("No pending tasks in current stage", {
        workflowID,
        stage: workflow.currentStage,
      })

      // Check if stage is complete and can progress
      const stageTasks = workflow.tasks.filter(
        (t) => t.stage === workflow.currentStage
      )
      const incompleteTasks = stageTasks.filter(
        (t) => t.status !== "completed" && t.status !== "skipped"
      )

      if (incompleteTasks.length === 0) {
        log.info("Stage complete, progressing to next stage", {
          workflowID,
          stage: workflow.currentStage,
        })
        await Orchestrator.progressStage(workflowID)
      }

      return
    }

    // Execute tasks sequentially (can be made parallel later)
    for (const task of pendingTasks) {
      // Check if dependencies are met
      if (!areDependenciesMet(task, workflow)) {
        log.info("Task dependencies not met, skipping", {
          workflowID,
          taskID: task.id,
          dependencies: task.dependencies,
        })
        continue
      }

      await executeTask({
        workflowID,
        taskID: task.id,
      })
    }
  }

  /**
   * Continuous execution loop for a workflow
   */
  export async function runWorkflow(workflowID: string): Promise<void> {
    log.info("Starting workflow execution loop", { workflowID })

    let iteration = 0
    const maxIterations = 1000 // Safety limit

    while (iteration < maxIterations) {
      iteration++

      const workflow = await Orchestrator.getWorkflow(workflowID)
      if (!workflow) {
        throw new Error(`Workflow ${workflowID} not found`)
      }

      if (workflow.status === "completed") {
        log.info("Workflow completed", { workflowID })
        break
      }

      if (workflow.status === "failed") {
        log.info("Workflow failed", { workflowID })
        break
      }

      if (workflow.status === "paused") {
        log.info("Workflow paused", { workflowID })
        break
      }

      // Process pending tasks
      await processPendingTasks(workflowID)

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    if (iteration >= maxIterations) {
      log.error("Workflow execution reached max iterations", { workflowID })
      throw new Error("Workflow execution timeout")
    }
  }

  /**
   * Check if task dependencies are met
   */
  function areDependenciesMet(task: Task, workflow: WorkflowInstance): boolean {
    for (const depTitle of task.dependencies) {
      const depTask = workflow.tasks.find((t) => t.title === depTitle)
      if (!depTask) {
        log.warn("Dependency task not found", {
          taskID: task.id,
          dependency: depTitle,
        })
        continue
      }

      if (depTask.status !== "completed" && depTask.status !== "skipped") {
        return false
      }
    }

    return true
  }

  /**
   * Build the task execution prompt
   */
  function buildTaskPrompt(
    workflow: WorkflowInstance,
    task: Task,
    agentConfig: { name: string; prompt?: string }
  ): string {
    const workspace = `Workspace: ${workflow.workspaceID}`
    const context = `
Workflow: ${workflow.title}
${workflow.description}

Current Stage: ${workflow.currentStage}

Task to Execute:
Title: ${task.title}
Description: ${task.description}
Estimated Time: ${task.estimatedTime} minutes
Priority: ${task.priority}

${task.metadata?.files ? `Files to modify:\n${task.metadata.files.map((f: string) => `- ${f}`).join("\n")}` : ""}
${task.metadata?.risks ? `\nPotential risks:\n${task.metadata.risks.map((r: string) => `- ${r}`).join("\n")}` : ""}

Dependencies:
${task.dependencies.length > 0 ? task.dependencies.map((d) => `- ${d}`).join("\n") : "None"}

Original PRD:
${workflow.prd}
`

    const agentPrompt = agentConfig.prompt || ""

    return `${agentPrompt}

${workspace}

${context}

Please execute this task according to the description and requirements. Focus on completing the specific task at hand.
`
  }

  /**
   * Get the AI model for an agent
   */
  async function getModelForAgent(agentConfig: {
    model?: { providerID: string; modelID: string }
  }) {
    if (agentConfig.model) {
      const result = await Provider.getModel(
        agentConfig.model.providerID,
        agentConfig.model.modelID
      )
      return result.language
    }

    // Use default model
    const defaultModel = await Provider.defaultModel()
    const result = await Provider.getModel(
      defaultModel.providerID,
      defaultModel.modelID
    )
    return result.language
  }
}
