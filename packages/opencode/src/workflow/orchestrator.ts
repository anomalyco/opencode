/**
 * Workflow Orchestrator
 *
 * Manages workflow execution, enforces state machine progression,
 * and coordinates specialized agents across workflow stages.
 */

import { ID } from "../id/index.js"
import { Storage } from "../storage/storage.js"
import { Bus } from "../bus/index.js"
import { Log } from "../util/log.js"
import { TaskMaster } from "./taskmaster.js"
import { Workspace } from "./workspace.js"
import { Metrics } from "./metrics.js"
import type {
  WorkflowInstance,
  WorkflowStage,
  WorkflowStatus,
  WorkflowEvent,
  WorkflowEventType,
  Task,
  TaskStatus,
  WorkflowConfig,
  WorkflowError,
} from "./types.js"

const log = Log.create({ service: "orchestrator" })

export namespace Orchestrator {
  const DEFAULT_CONFIG: WorkflowConfig = {
    stages: ["planning", "coding", "testing", "deployment"],
    autoProgress: false,
    retryOnFailure: true,
    maxRetries: 3,
    stageTimeouts: {
      planning: 30 * 60 * 1000, // 30 minutes
      coding: 120 * 60 * 1000, // 2 hours
      testing: 60 * 60 * 1000, // 1 hour
      deployment: 30 * 60 * 1000, // 30 minutes
    },
    approvalRequired: ["deployment"], // Require approval before deployment
  }

  /**
   * Create and start a new workflow from a PRD
   */
  export async function startWorkflow(params: {
    workspaceID: string
    prd: string
    config?: Partial<WorkflowConfig>
  }): Promise<WorkflowInstance> {
    const { workspaceID, prd, config: userConfig } = params

    log.info("Starting new workflow", { workspaceID })

    // Verify workspace exists
    const workspace = await Workspace.get(workspaceID)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceID} not found`)
    }

    // Parse PRD into tasks using TaskMaster AI
    log.info("Parsing PRD with TaskMaster AI")
    const breakdown = await TaskMaster.parsePRD(prd)

    // Validate tasks
    const validation = TaskMaster.validateTasks(breakdown.tasks)
    if (!validation.valid) {
      throw new Error(
        `Task validation failed: ${validation.errors.map((e) => e.message).join(", ")}`
      )
    }

    // Optimize task order
    const optimizedTasks = TaskMaster.optimizeTaskOrder(breakdown.tasks)

    // Create workflow instance
    const workflowID = ID.ascending()
    const now = Date.now()

    const workflow: WorkflowInstance = {
      id: workflowID,
      workspaceID,
      title: breakdown.title,
      description: breakdown.description,
      prd,
      currentStage: "planning",
      status: "running",
      tasks: TaskMaster.createTasksFromBreakdown(workflowID, {
        ...breakdown,
        tasks: optimizedTasks,
      }),
      history: [],
      time: {
        created: now,
        updated: now,
        started: now,
      },
    }

    // Save workflow
    await saveWorkflow(workflow)

    // Initialize metrics
    await Metrics.initialize(workflowID)

    // Publish workflow created event
    await publishEvent(workflow, {
      type: "workflow_created",
      data: {
        title: workflow.title,
        taskCount: workflow.tasks.length,
        estimatedDuration: breakdown.estimatedDuration,
      },
    })

    // Publish workflow started event
    await publishEvent(workflow, {
      type: "workflow_started",
      data: {
        stage: workflow.currentStage,
      },
    })

    log.info("Workflow created and started", {
      workflowID,
      taskCount: workflow.tasks.length,
    })

    return workflow
  }

  /**
   * Get workflow by ID
   */
  export async function getWorkflow(workflowID: string): Promise<WorkflowInstance | null> {
    try {
      return await Storage.read<WorkflowInstance>(["workflow", workflowID])
    } catch {
      return null
    }
  }

  /**
   * Progress to the next stage in the workflow
   */
  export async function progressStage(workflowID: string): Promise<WorkflowInstance> {
    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    if (workflow.status !== "running") {
      throw new Error(`Workflow is ${workflow.status}, cannot progress`)
    }

    const config = DEFAULT_CONFIG

    // Check if current stage is complete
    const currentStageTasks = workflow.tasks.filter(
      (t) => t.stage === workflow.currentStage
    )

    const incompleteTasks = currentStageTasks.filter(
      (t) => t.status !== "completed" && t.status !== "skipped"
    )

    if (incompleteTasks.length > 0) {
      throw new Error(
        `Cannot progress: ${incompleteTasks.length} tasks still incomplete in ${workflow.currentStage} stage`
      )
    }

    // Determine next stage
    const currentIndex = config.stages.indexOf(workflow.currentStage)
    if (currentIndex === -1 || currentIndex === config.stages.length - 1) {
      // Workflow complete
      return await completeWorkflow(workflowID)
    }

    const nextStage = config.stages[currentIndex + 1]

    // Update workflow
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      draft.currentStage = nextStage
      draft.time.updated = Date.now()
    })

    const updated = await getWorkflow(workflowID)
    if (!updated) {
      throw new Error("Failed to update workflow")
    }

    // Publish stage changed event
    await publishEvent(updated, {
      type: "stage_completed",
      data: {
        stage: workflow.currentStage,
      },
    })

    await publishEvent(updated, {
      type: "stage_started",
      data: {
        stage: nextStage,
      },
    })

    log.info("Workflow progressed to next stage", {
      workflowID,
      from: workflow.currentStage,
      to: nextStage,
    })

    return updated
  }

  /**
   * Start a task
   */
  export async function startTask(params: {
    workflowID: string
    taskID: string
    agentID: string
  }): Promise<Task> {
    const { workflowID, taskID, agentID } = params

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    const taskIndex = workflow.tasks.findIndex((t) => t.id === taskID)
    if (taskIndex === -1) {
      throw new Error(`Task ${taskID} not found in workflow`)
    }

    const task = workflow.tasks[taskIndex]

    // Check dependencies
    const unmetDependencies = task.dependencies.filter((depTitle) => {
      const depTask = workflow.tasks.find((t) => t.title === depTitle)
      return depTask && depTask.status !== "completed"
    })

    if (unmetDependencies.length > 0) {
      throw new Error(
        `Cannot start task: dependencies not met: ${unmetDependencies.join(", ")}`
      )
    }

    // Update task status
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      const t = draft.tasks[taskIndex]
      t.status = "active"
      t.agentID = agentID
      t.time.started = Date.now()
      draft.time.updated = Date.now()
    })

    const updated = await getWorkflow(workflowID)
    const updatedTask = updated!.tasks[taskIndex]

    // Publish task started event
    await publishEvent(updated!, {
      type: "task_started",
      data: {
        taskID,
        agentID,
        title: task.title,
      },
    })

    log.info("Task started", { workflowID, taskID, agentID })

    return updatedTask
  }

  /**
   * Complete a task
   */
  export async function completeTask(params: {
    workflowID: string
    taskID: string
    success?: boolean
    metadata?: Record<string, any>
  }): Promise<Task> {
    const { workflowID, taskID, success = true, metadata = {} } = params

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    const taskIndex = workflow.tasks.findIndex((t) => t.id === taskID)
    if (taskIndex === -1) {
      throw new Error(`Task ${taskID} not found`)
    }

    const task = workflow.tasks[taskIndex]

    // Calculate actual time
    const actualTime = task.time.started
      ? Date.now() - task.time.started
      : 0

    // Update task
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      const t = draft.tasks[taskIndex]
      t.status = success ? "completed" : "failed"
      t.actualTime = actualTime
      t.time.completed = Date.now()
      t.metadata = { ...t.metadata, ...metadata }
      draft.time.updated = Date.now()
    })

    const updated = await getWorkflow(workflowID)
    const updatedTask = updated!.tasks[taskIndex]

    // Record metrics
    await Metrics.recordTaskCompletion(workflowID, {
      taskID,
      agentID: task.agentID || "unknown",
      stage: task.stage,
      duration: actualTime,
      success,
    })

    // Publish event
    await publishEvent(updated!, {
      type: success ? "task_completed" : "task_failed",
      data: {
        taskID,
        title: task.title,
        duration: actualTime,
      },
    })

    log.info("Task completed", {
      workflowID,
      taskID,
      success,
      duration: actualTime,
    })

    return updatedTask
  }

  /**
   * Pause a workflow
   */
  export async function pauseWorkflow(workflowID: string): Promise<WorkflowInstance> {
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      draft.status = "paused"
      draft.time.updated = Date.now()
    })

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error("Failed to update workflow")
    }

    await publishEvent(workflow, {
      type: "workflow_paused",
      data: {},
    })

    log.info("Workflow paused", { workflowID })

    return workflow
  }

  /**
   * Resume a paused workflow
   */
  export async function resumeWorkflow(workflowID: string): Promise<WorkflowInstance> {
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      draft.status = "running"
      draft.time.updated = Date.now()
    })

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error("Failed to update workflow")
    }

    await publishEvent(workflow, {
      type: "workflow_resumed",
      data: {},
    })

    log.info("Workflow resumed", { workflowID })

    return workflow
  }

  /**
   * Handle workflow failure
   */
  export async function handleFailure(params: {
    workflowID: string
    error: Omit<WorkflowError, "id" | "workflowID">
  }): Promise<void> {
    const { workflowID, error } = params

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    const workflowError: WorkflowError = {
      id: ID.ascending(),
      workflowID,
      ...error,
    }

    // Record error in metrics
    await Metrics.recordError(workflowID, workflowError)

    // Publish error event
    await publishEvent(workflow, {
      type: "error",
      data: {
        errorID: workflowError.id,
        type: error.type,
        message: error.message,
        stage: error.stage,
      },
    })

    log.error("Workflow error", {
      workflowID,
      error: error.message,
      stage: error.stage,
    })

    // Check if we should retry or fail the workflow
    const config = DEFAULT_CONFIG
    const metrics = await Metrics.get(workflowID)

    if (config.retryOnFailure && metrics && metrics.retries < config.maxRetries) {
      log.info("Retrying workflow", {
        workflowID,
        attempt: metrics.retries + 1,
      })

      await Metrics.incrementRetries(workflowID)

      // If task-specific error, retry that task
      if (error.taskID) {
        const taskIndex = workflow.tasks.findIndex((t) => t.id === error.taskID)
        if (taskIndex !== -1) {
          await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
            draft.tasks[taskIndex].status = "pending"
            delete draft.tasks[taskIndex].time.started
            delete draft.tasks[taskIndex].time.completed
            draft.time.updated = Date.now()
          })
        }
      }
    } else {
      // Fail the workflow
      await failWorkflow(workflowID)
    }
  }

  /**
   * Complete a workflow
   */
  async function completeWorkflow(workflowID: string): Promise<WorkflowInstance> {
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      draft.status = "completed"
      draft.time.completed = Date.now()
      draft.time.updated = Date.now()
    })

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error("Failed to update workflow")
    }

    await publishEvent(workflow, {
      type: "workflow_completed",
      data: {
        duration: workflow.time.completed! - workflow.time.created,
        taskCount: workflow.tasks.length,
      },
    })

    log.info("Workflow completed", { workflowID })

    return workflow
  }

  /**
   * Fail a workflow
   */
  async function failWorkflow(workflowID: string): Promise<void> {
    await Storage.update<WorkflowInstance>(["workflow", workflowID], (draft) => {
      draft.status = "failed"
      draft.time.updated = Date.now()
    })

    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error("Failed to update workflow")
    }

    await publishEvent(workflow, {
      type: "workflow_failed",
      data: {},
    })

    log.error("Workflow failed", { workflowID })
  }

  /**
   * List workflows for a workspace
   */
  export async function listWorkflows(workspaceID: string): Promise<WorkflowInstance[]> {
    const allKeys = await Storage.list(["workflow"])
    const workflows = await Promise.all(
      allKeys.map((key) => Storage.read<WorkflowInstance>(key))
    )

    return workflows.filter((w) => w.workspaceID === workspaceID)
  }

  /**
   * Get tasks for current stage
   */
  export async function getCurrentStageTasks(workflowID: string): Promise<Task[]> {
    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      throw new Error(`Workflow ${workflowID} not found`)
    }

    return workflow.tasks.filter((t) => t.stage === workflow.currentStage)
  }

  /**
   * Get next available task
   */
  export async function getNextTask(workflowID: string): Promise<Task | null> {
    const workflow = await getWorkflow(workflowID)
    if (!workflow) {
      return null
    }

    const currentStageTasks = workflow.tasks.filter(
      (t) => t.stage === workflow.currentStage && t.status === "pending"
    )

    // Find task with all dependencies met
    for (const task of currentStageTasks) {
      const depsComplete = task.dependencies.every((depTitle) => {
        const depTask = workflow.tasks.find((t) => t.title === depTitle)
        return depTask?.status === "completed"
      })

      if (depsComplete) {
        return task
      }
    }

    return null
  }

  /**
   * Publish workflow event
   */
  async function publishEvent(
    workflow: WorkflowInstance,
    params: {
      type: WorkflowEventType
      data: Record<string, any>
    }
  ): Promise<void> {
    const event: WorkflowEvent = {
      id: ID.ascending(),
      workflowID: workflow.id,
      timestamp: Date.now(),
      stage: workflow.currentStage,
      type: params.type,
      data: params.data,
    }

    // Add to workflow history
    await Storage.update<WorkflowInstance>(["workflow", workflow.id], (draft) => {
      draft.history.push(event)
    })

    // Publish via event bus
    await Bus.publish("workflow:event", event)
  }

  /**
   * Save workflow to storage
   */
  async function saveWorkflow(workflow: WorkflowInstance): Promise<void> {
    await Storage.write<WorkflowInstance>(["workflow", workflow.id], workflow)
  }
}
