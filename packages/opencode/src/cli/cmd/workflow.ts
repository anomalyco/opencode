/**
 * Workflow CLI Command
 *
 * Provides CLI interface for autonomous workflow management.
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd.js"
import { bootstrap } from "../bootstrap.js"
import { UI } from "../ui.js"
import {
  Orchestrator,
  Workspace,
  TaskMaster,
  Metrics,
  Heuristics,
  SelfHealing,
  Executor,
} from "../../workflow/index.js"
import type { WorkflowInstance } from "../../workflow/types.js"

// Helper function to output styled text
function output(style?: string, message?: string) {
  if (!style && !message) {
    UI.empty()
  } else if (style && message) {
    UI.println(style + message + UI.Style.TEXT_NORMAL)
  }
}

export const WorkflowCommand = cmd({
  command: "workflow <action>",
  describe: "manage autonomous workflows",
  builder: (yargs: Argv) => {
    return yargs
      .command({
        command: "create",
        describe: "create a new workflow from a PRD",
        builder: (yargs: Argv) => {
          return yargs
            .option("prd", {
              describe: "path to PRD file or PRD text",
              type: "string",
              demandOption: true,
            })
            .option("workspace", {
              describe: "workspace ID or directory",
              type: "string",
            })
        },
        handler: async (argv) => {
          const prd = argv.prd as string
          const workspaceDir = (argv.workspace as string) || process.cwd()

          await bootstrap(workspaceDir, async () => {
            output(UI.Style.TEXT_SUCCESS_BOLD, "Creating autonomous workflow...")
            UI.empty()

            try {
              // Get or create workspace
              let workspace = await Workspace.fromDirectory(workspaceDir)

              if (!workspace) {
                output(UI.Style.TEXT_INFO, "Creating new workspace...")
                workspace = await Workspace.create({
                  directory: workspaceDir,
                })
                output(UI.Style.TEXT_SUCCESS, `✓ Workspace created: ${workspace.id}`)
                UI.empty()
              } else {
                output(UI.Style.TEXT_INFO, `Using workspace: ${workspace.id}`)
                UI.empty()
              }

              // Read PRD from file or use as text
              let prdContent = prd
              if (prd.endsWith(".md") || prd.endsWith(".txt")) {
                const fs = await import("fs/promises")
                prdContent = await fs.readFile(prd, "utf-8")
              }

              output(UI.Style.TEXT_INFO, "Analyzing PRD with TaskMaster AI...")
              UI.empty()

              // Start workflow
              const workflow = await Orchestrator.startWorkflow({
                workspaceID: workspace.id,
                prd: prdContent,
              })

              output(UI.Style.TEXT_SUCCESS_BOLD, `✓ Workflow created: ${workflow.id}`)
              UI.empty()
              output(UI.Style.TEXT_HIGHLIGHT, `Title: ${workflow.title}`)
              output(UI.Style.TEXT_DIM, `Description: ${workflow.description}`)
              UI.empty()
              output(UI.Style.TEXT_INFO, `Total tasks: ${workflow.tasks.length}`)
              output(UI.Style.TEXT_INFO, `Current stage: ${workflow.currentStage}`)
              UI.empty()

              // Show task breakdown by stage
              const stageGroups = {
                planning: workflow.tasks.filter((t) => t.stage === "planning"),
                coding: workflow.tasks.filter((t) => t.stage === "coding"),
                testing: workflow.tasks.filter((t) => t.stage === "testing"),
                deployment: workflow.tasks.filter((t) => t.stage === "deployment"),
              }

              output(UI.Style.TEXT_WARNING_BOLD, "Task Breakdown:")
              for (const [stage, tasks] of Object.entries(stageGroups)) {
                if (tasks.length > 0) {
                  output(UI.Style.TEXT_INFO, `  ${stage}: ${tasks.length} tasks`)
                }
              }
              UI.empty()

              output(UI.Style.TEXT_SUCCESS, `Use 'opencode workflow status ${workflow.id}' to check progress`)
              output(UI.Style.TEXT_SUCCESS, `Use 'opencode workflow run ${workflow.id}' to start execution`)
            } catch (error) {
              output(UI.Style.TEXT_DANGER_BOLD, "✗ Failed to create workflow")
              output(UI.Style.TEXT_DANGER, error instanceof Error ? error.message : String(error))
              process.exit(1)
            }
          })
        },
      })
      .command({
        command: "status <workflow-id>",
        describe: "show workflow status",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            const workflow = await Orchestrator.getWorkflow(workflowID)
            if (!workflow) {
              output(UI.Style.TEXT_DANGER, `Workflow ${workflowID} not found`)
              process.exit(1)
            }

            displayWorkflowStatus(workflow)
          })
        },
      })
      .command({
        command: "run <workflow-id>",
        describe: "start workflow execution",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            output(UI.Style.TEXT_INFO, "Fetching workflow...")
            const workflow = await Orchestrator.getWorkflow(workflowID)
            if (!workflow) {
              output(UI.Style.TEXT_DANGER, `Workflow ${workflowID} not found`)
              process.exit(1)
            }

            output(UI.Style.TEXT_SUCCESS_BOLD, `Starting workflow execution: ${workflow.title}`)
            output(UI.Style.TEXT_INFO, `Workflow ID: ${workflowID}`)
            output(UI.Style.TEXT_INFO, `Current Stage: ${workflow.currentStage}`)
            output(UI.Style.TEXT_INFO, `Status: ${workflow.status}`)

            const pendingTasks = workflow.tasks.filter((t) => t.status === "pending")
            output(UI.Style.TEXT_INFO, `Pending Tasks: ${pendingTasks.length}`)
            UI.empty()

            try {
              output(UI.Style.TEXT_HIGHLIGHT, "Starting execution loop...")
              UI.empty()

              // Run the workflow execution loop
              await Executor.runWorkflow(workflowID)

              UI.empty()
              output(UI.Style.TEXT_SUCCESS_BOLD, "✓ Workflow execution completed")
            } catch (error) {
              UI.empty()
              output(UI.Style.TEXT_DANGER_BOLD, "✗ Workflow execution failed")
              output(UI.Style.TEXT_DANGER, error instanceof Error ? error.message : String(error))
              if (error instanceof Error && error.stack) {
                output(UI.Style.TEXT_DIM, error.stack)
              }
              process.exit(1)
            }
          })
        },
      })
      .command({
        command: "list",
        describe: "list all workflows",
        builder: (yargs: Argv) => {
          return yargs.option("workspace", {
            describe: "filter by workspace ID",
            type: "string",
          })
        },
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workspaceID = argv.workspace as string | undefined

            // Get all workflows
            const allKeys = await import("../../storage/storage.js").then((m) => m.Storage.list(["workflow"]))
            const workflows = await Promise.all(
              allKeys.map((key) =>
                import("../../storage/storage.js").then((m) => m.Storage.read<WorkflowInstance>(key)),
              ),
            )

            const filtered = workspaceID ? workflows.filter((w) => w.workspaceID === workspaceID) : workflows

            if (filtered.length === 0) {
              output(UI.Style.TEXT_DIM, "No workflows found")
              return
            }

            output(UI.Style.TEXT_SUCCESS_BOLD, `Found ${filtered.length} workflow(s):\n`)

            for (const workflow of filtered) {
              output(UI.Style.TEXT_HIGHLIGHT, `${workflow.id}`)
              output(UI.Style.TEXT_INFO, `  Title: ${workflow.title}`)
              output(UI.Style.TEXT_INFO, `  Status: ${workflow.status}`)
              output(UI.Style.TEXT_INFO, `  Stage: ${workflow.currentStage}`)
              output(
                UI.Style.TEXT_DIM,
                `  Tasks: ${workflow.tasks.filter((t) => t.status === "completed").length}/${workflow.tasks.length} completed`,
              )
              UI.empty()
            }
          })
        },
      })
      .command({
        command: "progress <workflow-id>",
        describe: "progress workflow to next stage",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            try {
              output(UI.Style.TEXT_INFO, "Progressing workflow to next stage...")

              const workflow = await Orchestrator.progressStage(workflowID)

              output(UI.Style.TEXT_SUCCESS_BOLD, `✓ Workflow progressed to ${workflow.currentStage}`)

              displayWorkflowStatus(workflow)
            } catch (error) {
              output(UI.Style.TEXT_DANGER, error instanceof Error ? error.message : String(error))
              process.exit(1)
            }
          })
        },
      })
      .command({
        command: "pause <workflow-id>",
        describe: "pause a running workflow",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            await Orchestrator.pauseWorkflow(workflowID)

            output(UI.Style.TEXT_SUCCESS, `✓ Workflow paused`)
          })
        },
      })
      .command({
        command: "resume <workflow-id>",
        describe: "resume a paused workflow",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            await Orchestrator.resumeWorkflow(workflowID)

            output(UI.Style.TEXT_SUCCESS, `✓ Workflow resumed`)
          })
        },
      })
      .command({
        command: "logs <workflow-id>",
        describe: "show logs for the current active task",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            const workflow = await Orchestrator.getWorkflow(workflowID)
            if (!workflow) {
              output(UI.Style.TEXT_DANGER, `Workflow ${workflowID} not found`)
              process.exit(1)
            }

            const activeTask = workflow.tasks.find((t) => t.status === "active")
            if (!activeTask) {
              output(UI.Style.TEXT_INFO, "No active task currently running")
              UI.empty()

              const recentTask = workflow.tasks
                .filter((t) => t.status === "completed" || t.status === "failed")
                .sort((a, b) => (b.time.completed || 0) - (a.time.completed || 0))[0]

              if (recentTask) {
                output(UI.Style.TEXT_DIM, `Most recent task: ${recentTask.title}`)
                output(UI.Style.TEXT_DIM, `Status: ${recentTask.status}`)
                if (recentTask.time.completed) {
                  const completedAt = new Date(recentTask.time.completed).toLocaleString()
                  output(UI.Style.TEXT_DIM, `Completed: ${completedAt}`)
                }
              }
              return
            }

            output(UI.Style.TEXT_SUCCESS_BOLD, `Active Task Logs\n`)
            output(UI.Style.TEXT_HIGHLIGHT, `Task ID: ${activeTask.id}`)
            output(UI.Style.TEXT_INFO, `Title: ${activeTask.title}`)
            output(UI.Style.TEXT_DIM, `Description: ${activeTask.description}`)
            UI.empty()

            output(UI.Style.TEXT_WARNING_BOLD, "Details:")
            output(UI.Style.TEXT_INFO, `  Stage: ${activeTask.stage}`)
            output(UI.Style.TEXT_INFO, `  Status: ${activeTask.status}`)
            output(UI.Style.TEXT_INFO, `  Agent: ${activeTask.agentID || "unassigned"}`)
            output(UI.Style.TEXT_INFO, `  Priority: ${activeTask.priority}`)
            output(UI.Style.TEXT_INFO, `  Estimated time: ${activeTask.estimatedTime} minutes`)
            UI.empty()

            if (activeTask.time.started) {
              const startedAt = new Date(activeTask.time.started).toLocaleString()
              const elapsed = Date.now() - activeTask.time.started
              output(UI.Style.TEXT_WARNING_BOLD, "Timing:")
              output(UI.Style.TEXT_INFO, `  Started: ${startedAt}`)
              output(UI.Style.TEXT_INFO, `  Elapsed: ${formatDuration(elapsed)}`)
              UI.empty()
            }

            if (activeTask.dependencies.length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Dependencies:")
              for (const dep of activeTask.dependencies) {
                const depTask = workflow.tasks.find((t) => t.title === dep)
                if (depTask) {
                  output(UI.Style.TEXT_DIM, `  - ${dep} [${depTask.status}]`)
                } else {
                  output(UI.Style.TEXT_DIM, `  - ${dep}`)
                }
              }
              UI.empty()
            }

            if (activeTask.metadata && Object.keys(activeTask.metadata).length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Metadata:")
              if (activeTask.metadata.files) {
                output(UI.Style.TEXT_INFO, `  Files to modify:`)
                for (const file of activeTask.metadata.files) {
                  output(UI.Style.TEXT_DIM, `    - ${file}`)
                }
              }
              if (activeTask.metadata.risks) {
                output(UI.Style.TEXT_INFO, `  Risks:`)
                for (const risk of activeTask.metadata.risks) {
                  output(UI.Style.TEXT_DIM, `    - ${risk}`)
                }
              }
              UI.empty()
            }

            const recentEvents = workflow.history
              .filter((e) => e.taskID === activeTask.id)
              .slice(-10)
              .sort((a, b) => b.timestamp - a.timestamp)

            if (recentEvents.length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Recent Events:")
              for (const event of recentEvents) {
                const timestamp = new Date(event.timestamp).toLocaleTimeString()
                output(UI.Style.TEXT_INFO, `  [${timestamp}] ${event.type}`)
                if (Object.keys(event.data).length > 0) {
                  output(UI.Style.TEXT_DIM, `    ${JSON.stringify(event.data, null, 2).replace(/\n/g, "\n    ")}`)
                }
              }
            }
          })
        },
      })
      .command({
        command: "metrics <workflow-id>",
        describe: "show workflow metrics",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            const metrics = await Metrics.get(workflowID)

            if (!metrics) {
              output(UI.Style.TEXT_DANGER, "Metrics not found")
              process.exit(1)
            }

            output(UI.Style.TEXT_SUCCESS_BOLD, "Workflow Metrics\n")

            output(UI.Style.TEXT_WARNING_BOLD, "Duration:")
            output(UI.Style.TEXT_INFO, `  Total: ${formatDuration(metrics.duration.total)}`)
            output(UI.Style.TEXT_INFO, `  Planning: ${formatDuration(metrics.duration.planning)}`)
            output(UI.Style.TEXT_INFO, `  Coding: ${formatDuration(metrics.duration.coding)}`)
            output(UI.Style.TEXT_INFO, `  Testing: ${formatDuration(metrics.duration.testing)}`)
            output(UI.Style.TEXT_INFO, `  Deployment: ${formatDuration(metrics.duration.deployment)}`)
            UI.empty()

            output(UI.Style.TEXT_WARNING_BOLD, "Tasks:")
            output(UI.Style.TEXT_INFO, `  Total: ${metrics.tasks.total}`)
            output(UI.Style.TEXT_SUCCESS, `  Completed: ${metrics.tasks.completed}`)
            output(UI.Style.TEXT_DANGER, `  Failed: ${metrics.tasks.failed}`)
            output(UI.Style.TEXT_DIM, `  Skipped: ${metrics.tasks.skipped}`)
            UI.empty()

            if (metrics.tests.total > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Tests:")
              output(UI.Style.TEXT_INFO, `  Total: ${metrics.tests.total}`)
              output(UI.Style.TEXT_SUCCESS, `  Passed: ${metrics.tests.passed}`)
              output(UI.Style.TEXT_DANGER, `  Failed: ${metrics.tests.failed}`)
              UI.empty()
            }

            if (metrics.errors.length > 0) {
              output(UI.Style.TEXT_DANGER_BOLD, `Errors: ${metrics.errors.length}`)
              for (const error of metrics.errors.slice(0, 5)) {
                output(UI.Style.TEXT_DANGER, `  ${error.type}: ${error.message}`)
              }
              UI.empty()
            }

            output(UI.Style.TEXT_WARNING_BOLD, "Agent Performance:")
            for (const [agentID, agentMetrics] of Object.entries(metrics.agents)) {
              output(UI.Style.TEXT_INFO, `  ${agentID}:`)
              output(UI.Style.TEXT_DIM, `    Invocations: ${agentMetrics.invocations}`)
              output(UI.Style.TEXT_DIM, `    Success rate: ${(agentMetrics.successRate * 100).toFixed(1)}%`)
              output(UI.Style.TEXT_DIM, `    Avg duration: ${formatDuration(agentMetrics.averageDuration)}`)
            }
          })
        },
      })
      .command({
        command: "logs <workflow-id>",
        describe: "show logs for the current active task",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            const workflowID = argv.workflowId as string

            const workflow = await Orchestrator.getWorkflow(workflowID)
            if (!workflow) {
              output(UI.Style.TEXT_DANGER, `Workflow ${workflowID} not found`)
              process.exit(1)
            }

            const activeTask = workflow.tasks.find((t) => t.status === "active")
            if (!activeTask) {
              output(UI.Style.TEXT_INFO, "No active task currently running")
              UI.empty()

              const recentTask = workflow.tasks
                .filter((t) => t.status === "completed" || t.status === "failed")
                .sort((a, b) => (b.time.completed || 0) - (a.time.completed || 0))[0]

              if (recentTask) {
                output(UI.Style.TEXT_DIM, `Most recent task: ${recentTask.title}`)
                output(UI.Style.TEXT_DIM, `Status: ${recentTask.status}`)
                if (recentTask.time.completed) {
                  const completedAt = new Date(recentTask.time.completed).toLocaleString()
                  output(UI.Style.TEXT_DIM, `Completed: ${completedAt}`)
                }
              }
              return
            }

            output(UI.Style.TEXT_SUCCESS_BOLD, `Active Task Logs\n`)
            output(UI.Style.TEXT_HIGHLIGHT, `Task ID: ${activeTask.id}`)
            output(UI.Style.TEXT_INFO, `Title: ${activeTask.title}`)
            output(UI.Style.TEXT_DIM, `Description: ${activeTask.description}`)
            UI.empty()

            output(UI.Style.TEXT_WARNING_BOLD, "Details:")
            output(UI.Style.TEXT_INFO, `  Stage: ${activeTask.stage}`)
            output(UI.Style.TEXT_INFO, `  Status: ${activeTask.status}`)
            output(UI.Style.TEXT_INFO, `  Agent: ${activeTask.agentID || "unassigned"}`)
            output(UI.Style.TEXT_INFO, `  Priority: ${activeTask.priority}`)
            output(UI.Style.TEXT_INFO, `  Estimated time: ${activeTask.estimatedTime} minutes`)
            UI.empty()

            if (activeTask.time.started) {
              const startedAt = new Date(activeTask.time.started).toLocaleString()
              const elapsed = Date.now() - activeTask.time.started
              output(UI.Style.TEXT_WARNING_BOLD, "Timing:")
              output(UI.Style.TEXT_INFO, `  Started: ${startedAt}`)
              output(UI.Style.TEXT_INFO, `  Elapsed: ${formatDuration(elapsed)}`)
              UI.empty()
            }

            if (activeTask.dependencies.length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Dependencies:")
              for (const dep of activeTask.dependencies) {
                const depTask = workflow.tasks.find((t) => t.title === dep)
                if (depTask) {
                  output(UI.Style.TEXT_DIM, `  - ${dep} [${depTask.status}]`)
                } else {
                  output(UI.Style.TEXT_DIM, `  - ${dep}`)
                }
              }
              UI.empty()
            }

            if (activeTask.metadata && Object.keys(activeTask.metadata).length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Metadata:")
              if (activeTask.metadata.files) {
                output(UI.Style.TEXT_INFO, `  Files to modify:`)
                for (const file of activeTask.metadata.files) {
                  output(UI.Style.TEXT_DIM, `    - ${file}`)
                }
              }
              if (activeTask.metadata.risks) {
                output(UI.Style.TEXT_INFO, `  Risks:`)
                for (const risk of activeTask.metadata.risks) {
                  output(UI.Style.TEXT_DIM, `    - ${risk}`)
                }
              }
              UI.empty()
            }

            const recentEvents = workflow.history
              .filter((e) => e.taskID === activeTask.id)
              .slice(-10)
              .sort((a, b) => b.timestamp - a.timestamp)

            if (recentEvents.length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, "Recent Events:")
              for (const event of recentEvents) {
                const timestamp = new Date(event.timestamp).toLocaleTimeString()
                output(UI.Style.TEXT_INFO, `  [${timestamp}] ${event.type}`)
                if (Object.keys(event.data).length > 0) {
                  output(UI.Style.TEXT_DIM, `    ${JSON.stringify(event.data, null, 2).replace(/\n/g, "\n    ")}`)
                }
              }
            }
          })
        },
      })
      .command({
        command: "analyze",
        describe: "analyze workflow patterns and suggest optimizations",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            output(UI.Style.TEXT_INFO, "Analyzing workflow patterns...")
            UI.empty()

            const patterns = await Heuristics.analyzeFailurePatterns()
            const bottlenecks = await Heuristics.identifyBottlenecks()
            const optimizations = await Heuristics.suggestOptimizations()

            if (patterns.length > 0) {
              output(UI.Style.TEXT_DANGER_BOLD, `Failure Patterns (${patterns.length}):\n`)
              for (const pattern of patterns.slice(0, 5)) {
                output(UI.Style.TEXT_WARNING, `${pattern.type} (${pattern.occurrences} occurrences)`)
                output(UI.Style.TEXT_DIM, `  ${pattern.description}`)
                output(UI.Style.TEXT_SUCCESS, `  Fix: ${pattern.suggestedFix}`)
                UI.empty()
              }
            }

            if (bottlenecks.length > 0) {
              output(UI.Style.TEXT_WARNING_BOLD, `Bottlenecks (${bottlenecks.length}):\n`)
              for (const bottleneck of bottlenecks.slice(0, 5)) {
                output(UI.Style.TEXT_INFO, `${bottleneck.stage} (${bottleneck.agentID})`)
                output(UI.Style.TEXT_DIM, `  Avg delay: ${formatDuration(bottleneck.averageDelay)}`)
                output(UI.Style.TEXT_DIM, `  Causes: ${bottleneck.causes.join(", ")}`)
                UI.empty()
              }
            }

            if (optimizations.length > 0) {
              output(UI.Style.TEXT_SUCCESS_BOLD, `Optimizations (${optimizations.length}):\n`)
              for (const opt of optimizations.slice(0, 5)) {
                output(UI.Style.TEXT_HIGHLIGHT, opt.description)
                output(UI.Style.TEXT_DIM, `  Expected improvement: ${(opt.expectedImprovement * 100).toFixed(1)}%`)
                output(UI.Style.TEXT_DIM, `  Risk: ${opt.riskLevel}`)
                UI.empty()
              }
            }
          })
        },
      })
      .demandCommand(1, "You need to specify a workflow command")
  },
  handler: () => {
    // This is handled by the subcommands
  },
})

/**
 * Display workflow status
 */
function displayWorkflowStatus(workflow: WorkflowInstance) {
  UI.empty()
  output(UI.Style.TEXT_SUCCESS_BOLD, `Workflow: ${workflow.title}`)
  UI.empty()
  output(UI.Style.TEXT_INFO, `ID: ${workflow.id}`)
  output(UI.Style.TEXT_INFO, `Status: ${workflow.status}`)
  output(UI.Style.TEXT_INFO, `Current Stage: ${workflow.currentStage}`)
  UI.empty()

  // Show task progress by stage
  const stages = ["planning", "coding", "testing", "deployment"] as const

  output(UI.Style.TEXT_WARNING_BOLD, "Progress:")
  for (const stage of stages) {
    const stageTasks = workflow.tasks.filter((t) => t.stage === stage)
    const completed = stageTasks.filter((t) => t.status === "completed").length
    const active = stageTasks.filter((t) => t.status === "active").length
    const failed = stageTasks.filter((t) => t.status === "failed").length

    const statusIndicator = stage === workflow.currentStage ? "→" : completed === stageTasks.length ? "✓" : "·"

    const statusText = `${statusIndicator} ${stage}: ${completed}/${stageTasks.length} completed`

    if (stage === workflow.currentStage) {
      output(UI.Style.TEXT_SUCCESS_BOLD, `  ${statusText}`)
    } else if (completed === stageTasks.length) {
      output(UI.Style.TEXT_DIM, `  ${statusText}`)
    } else {
      output(UI.Style.TEXT_INFO, `  ${statusText}`)
    }

    if (active > 0) {
      output(UI.Style.TEXT_WARNING, `    ${active} active`)
    }
    if (failed > 0) {
      output(UI.Style.TEXT_DANGER, `    ${failed} failed`)
    }
  }

  UI.empty()

  // Show current task if any
  const currentTask = workflow.tasks.find((t) => t.status === "active")
  if (currentTask) {
    output(UI.Style.TEXT_HIGHLIGHT_BOLD, "Current Task:")
    output(UI.Style.TEXT_INFO, `  ${currentTask.title}`)
    output(UI.Style.TEXT_DIM, `  Agent: ${currentTask.agentID || "unassigned"}`)
    UI.empty()
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms === 0) return "0s"

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}
