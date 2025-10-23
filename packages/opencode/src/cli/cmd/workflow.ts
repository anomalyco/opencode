/**
 * Workflow CLI Command
 *
 * Provides CLI interface for autonomous workflow management.
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd.js"
import { bootstrap } from "../bootstrap.js"
import { UI } from "../ui.js"
import { Orchestrator, Workspace, TaskMaster, Metrics, Heuristics, SelfHealing } from "../../workflow/index.js"
import type { WorkflowInstance } from "../../workflow/types.js"

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
            UI.output(UI.Style.TEXT_SUCCESS_BOLD, "Creating autonomous workflow...")
            UI.output()

            try {
              // Get or create workspace
              let workspace = await Workspace.fromDirectory(workspaceDir)

              if (!workspace) {
                UI.output(UI.Style.TEXT_INFO, "Creating new workspace...")
                workspace = await Workspace.create({
                  directory: workspaceDir,
                })
                UI.output(UI.Style.TEXT_SUCCESS, `✓ Workspace created: ${workspace.id}`)
                UI.output()
              } else {
                UI.output(UI.Style.TEXT_INFO, `Using workspace: ${workspace.id}`)
                UI.output()
              }

              // Read PRD from file or use as text
              let prdContent = prd
              if (prd.endsWith(".md") || prd.endsWith(".txt")) {
                const fs = await import("fs/promises")
                prdContent = await fs.readFile(prd, "utf-8")
              }

              UI.output(UI.Style.TEXT_INFO, "Analyzing PRD with TaskMaster AI...")
              UI.output()

              // Start workflow
              const workflow = await Orchestrator.startWorkflow({
                workspaceID: workspace.id,
                prd: prdContent,
              })

              UI.output(UI.Style.TEXT_SUCCESS_BOLD, `✓ Workflow created: ${workflow.id}`)
              UI.output()
              UI.output(UI.Style.TEXT_HIGHLIGHT, `Title: ${workflow.title}`)
              UI.output(UI.Style.TEXT_DIM, `Description: ${workflow.description}`)
              UI.output()
              UI.output(UI.Style.TEXT_INFO, `Total tasks: ${workflow.tasks.length}`)
              UI.output(UI.Style.TEXT_INFO, `Current stage: ${workflow.currentStage}`)
              UI.output()

              // Show task breakdown by stage
              const stageGroups = {
                planning: workflow.tasks.filter(t => t.stage === "planning"),
                coding: workflow.tasks.filter(t => t.stage === "coding"),
                testing: workflow.tasks.filter(t => t.stage === "testing"),
                deployment: workflow.tasks.filter(t => t.stage === "deployment"),
              }

              UI.output(UI.Style.TEXT_WARNING_BOLD, "Task Breakdown:")
              for (const [stage, tasks] of Object.entries(stageGroups)) {
                if (tasks.length > 0) {
                  UI.output(UI.Style.TEXT_INFO, `  ${stage}: ${tasks.length} tasks`)
                }
              }
              UI.output()

              UI.output(UI.Style.TEXT_SUCCESS, `Use 'opencode workflow status ${workflow.id}' to check progress`)
              UI.output(UI.Style.TEXT_SUCCESS, `Use 'opencode workflow run ${workflow.id}' to start execution`)

            } catch (error) {
              UI.output(UI.Style.TEXT_DANGER_BOLD, "✗ Failed to create workflow")
              UI.output(UI.Style.TEXT_DANGER, error instanceof Error ? error.message : String(error))
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
              UI.output(UI.Style.TEXT_DANGER, `Workflow ${workflowID} not found`)
              process.exit(1)
            }

            displayWorkflowStatus(workflow)
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
            const allKeys = await import("../../storage/storage.js").then(m => m.Storage.list(["workflow"]))
            const workflows = await Promise.all(
              allKeys.map(key => import("../../storage/storage.js").then(m => m.Storage.read<WorkflowInstance>(key)))
            )

            const filtered = workspaceID
              ? workflows.filter(w => w.workspaceID === workspaceID)
              : workflows

            if (filtered.length === 0) {
              UI.output(UI.Style.TEXT_DIM, "No workflows found")
              return
            }

            UI.output(UI.Style.TEXT_SUCCESS_BOLD, `Found ${filtered.length} workflow(s):\n`)

            for (const workflow of filtered) {
              UI.output(UI.Style.TEXT_HIGHLIGHT, `${workflow.id}`)
              UI.output(UI.Style.TEXT_INFO, `  Title: ${workflow.title}`)
              UI.output(UI.Style.TEXT_INFO, `  Status: ${workflow.status}`)
              UI.output(UI.Style.TEXT_INFO, `  Stage: ${workflow.currentStage}`)
              UI.output(UI.Style.TEXT_DIM, `  Tasks: ${workflow.tasks.filter(t => t.status === "completed").length}/${workflow.tasks.length} completed`)
              UI.output()
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
              UI.output(UI.Style.TEXT_INFO, "Progressing workflow to next stage...")

              const workflow = await Orchestrator.progressStage(workflowID)

              UI.output(UI.Style.TEXT_SUCCESS_BOLD, `✓ Workflow progressed to ${workflow.currentStage}`)

              displayWorkflowStatus(workflow)
            } catch (error) {
              UI.output(UI.Style.TEXT_DANGER, error instanceof Error ? error.message : String(error))
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

            UI.output(UI.Style.TEXT_SUCCESS, `✓ Workflow paused`)
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

            UI.output(UI.Style.TEXT_SUCCESS, `✓ Workflow resumed`)
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
              UI.output(UI.Style.TEXT_DANGER, "Metrics not found")
              process.exit(1)
            }

            UI.output(UI.Style.TEXT_SUCCESS_BOLD, "Workflow Metrics\n")

            UI.output(UI.Style.TEXT_WARNING_BOLD, "Duration:")
            UI.output(UI.Style.TEXT_INFO, `  Total: ${formatDuration(metrics.duration.total)}`)
            UI.output(UI.Style.TEXT_INFO, `  Planning: ${formatDuration(metrics.duration.planning)}`)
            UI.output(UI.Style.TEXT_INFO, `  Coding: ${formatDuration(metrics.duration.coding)}`)
            UI.output(UI.Style.TEXT_INFO, `  Testing: ${formatDuration(metrics.duration.testing)}`)
            UI.output(UI.Style.TEXT_INFO, `  Deployment: ${formatDuration(metrics.duration.deployment)}`)
            UI.output()

            UI.output(UI.Style.TEXT_WARNING_BOLD, "Tasks:")
            UI.output(UI.Style.TEXT_INFO, `  Total: ${metrics.tasks.total}`)
            UI.output(UI.Style.TEXT_SUCCESS, `  Completed: ${metrics.tasks.completed}`)
            UI.output(UI.Style.TEXT_DANGER, `  Failed: ${metrics.tasks.failed}`)
            UI.output(UI.Style.TEXT_DIM, `  Skipped: ${metrics.tasks.skipped}`)
            UI.output()

            if (metrics.tests.total > 0) {
              UI.output(UI.Style.TEXT_WARNING_BOLD, "Tests:")
              UI.output(UI.Style.TEXT_INFO, `  Total: ${metrics.tests.total}`)
              UI.output(UI.Style.TEXT_SUCCESS, `  Passed: ${metrics.tests.passed}`)
              UI.output(UI.Style.TEXT_DANGER, `  Failed: ${metrics.tests.failed}`)
              UI.output()
            }

            if (metrics.errors.length > 0) {
              UI.output(UI.Style.TEXT_DANGER_BOLD, `Errors: ${metrics.errors.length}`)
              for (const error of metrics.errors.slice(0, 5)) {
                UI.output(UI.Style.TEXT_DANGER, `  ${error.type}: ${error.message}`)
              }
              UI.output()
            }

            UI.output(UI.Style.TEXT_WARNING_BOLD, "Agent Performance:")
            for (const [agentID, agentMetrics] of Object.entries(metrics.agents)) {
              UI.output(UI.Style.TEXT_INFO, `  ${agentID}:`)
              UI.output(UI.Style.TEXT_DIM, `    Invocations: ${agentMetrics.invocations}`)
              UI.output(UI.Style.TEXT_DIM, `    Success rate: ${(agentMetrics.successRate * 100).toFixed(1)}%`)
              UI.output(UI.Style.TEXT_DIM, `    Avg duration: ${formatDuration(agentMetrics.averageDuration)}`)
            }
          })
        },
      })
      .command({
        command: "analyze",
        describe: "analyze workflow patterns and suggest optimizations",
        handler: async (argv) => {
          await bootstrap(process.cwd(), async () => {
            UI.output(UI.Style.TEXT_INFO, "Analyzing workflow patterns...")
            UI.output()

            const patterns = await Heuristics.analyzeFailurePatterns()
            const bottlenecks = await Heuristics.identifyBottlenecks()
            const optimizations = await Heuristics.suggestOptimizations()

            if (patterns.length > 0) {
              UI.output(UI.Style.TEXT_DANGER_BOLD, `Failure Patterns (${patterns.length}):\n`)
              for (const pattern of patterns.slice(0, 5)) {
                UI.output(UI.Style.TEXT_WARNING, `${pattern.type} (${pattern.occurrences} occurrences)`)
                UI.output(UI.Style.TEXT_DIM, `  ${pattern.description}`)
                UI.output(UI.Style.TEXT_SUCCESS, `  Fix: ${pattern.suggestedFix}`)
                UI.output()
              }
            }

            if (bottlenecks.length > 0) {
              UI.output(UI.Style.TEXT_WARNING_BOLD, `Bottlenecks (${bottlenecks.length}):\n`)
              for (const bottleneck of bottlenecks.slice(0, 5)) {
                UI.output(UI.Style.TEXT_INFO, `${bottleneck.stage} (${bottleneck.agentID})`)
                UI.output(UI.Style.TEXT_DIM, `  Avg delay: ${formatDuration(bottleneck.averageDelay)}`)
                UI.output(UI.Style.TEXT_DIM, `  Causes: ${bottleneck.causes.join(", ")}`)
                UI.output()
              }
            }

            if (optimizations.length > 0) {
              UI.output(UI.Style.TEXT_SUCCESS_BOLD, `Optimizations (${optimizations.length}):\n`)
              for (const opt of optimizations.slice(0, 5)) {
                UI.output(UI.Style.TEXT_HIGHLIGHT, opt.description)
                UI.output(UI.Style.TEXT_DIM, `  Expected improvement: ${(opt.expectedImprovement * 100).toFixed(1)}%`)
                UI.output(UI.Style.TEXT_DIM, `  Risk: ${opt.riskLevel}`)
                UI.output()
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
  UI.output()
  UI.output(UI.Style.TEXT_SUCCESS_BOLD, `Workflow: ${workflow.title}`)
  UI.output()
  UI.output(UI.Style.TEXT_INFO, `ID: ${workflow.id}`)
  UI.output(UI.Style.TEXT_INFO, `Status: ${workflow.status}`)
  UI.output(UI.Style.TEXT_INFO, `Current Stage: ${workflow.currentStage}`)
  UI.output()

  // Show task progress by stage
  const stages = ["planning", "coding", "testing", "deployment"] as const

  UI.output(UI.Style.TEXT_WARNING_BOLD, "Progress:")
  for (const stage of stages) {
    const stageTasks = workflow.tasks.filter(t => t.stage === stage)
    const completed = stageTasks.filter(t => t.status === "completed").length
    const active = stageTasks.filter(t => t.status === "active").length
    const failed = stageTasks.filter(t => t.status === "failed").length

    const statusIndicator =
      stage === workflow.currentStage ? "→" :
      completed === stageTasks.length ? "✓" :
      "·"

    const statusText = `${statusIndicator} ${stage}: ${completed}/${stageTasks.length} completed`

    if (stage === workflow.currentStage) {
      UI.output(UI.Style.TEXT_SUCCESS_BOLD, `  ${statusText}`)
    } else if (completed === stageTasks.length) {
      UI.output(UI.Style.TEXT_DIM, `  ${statusText}`)
    } else {
      UI.output(UI.Style.TEXT_INFO, `  ${statusText}`)
    }

    if (active > 0) {
      UI.output(UI.Style.TEXT_WARNING, `    ${active} active`)
    }
    if (failed > 0) {
      UI.output(UI.Style.TEXT_DANGER, `    ${failed} failed`)
    }
  }

  UI.output()

  // Show current task if any
  const currentTask = workflow.tasks.find(t => t.status === "active")
  if (currentTask) {
    UI.output(UI.Style.TEXT_HIGHLIGHT_BOLD, "Current Task:")
    UI.output(UI.Style.TEXT_INFO, `  ${currentTask.title}`)
    UI.output(UI.Style.TEXT_DIM, `  Agent: ${currentTask.agentID || "unassigned"}`)
    UI.output()
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
