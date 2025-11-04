import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./complete-task.txt"
import { Session } from "../session"
import { TaskHierarchy } from "../session/task-hierarchy"
import { Log } from "../util/log"

const log = Log.create({ service: "complete-task-tool" })

type CompleteTaskMetadata = {
  sessionID: string
  parentSessionID: string
  summary: string
  depth: number
}

/**
 * Complete Task Tool
 *
 * Production-grade subtask completion for orchestration workflows.
 * Enables clean handoff of results back to parent tasks.
 */
export const CompleteTaskTool = Tool.define("complete_task", {
  description: DESCRIPTION,
  parameters: z.object({
    summary: z
      .string()
      .describe(
        "Brief one-line summary of what was accomplished (e.g., 'Implemented authentication')",
      ),
    result: z
      .string()
      .describe(
        "Detailed results to pass back to parent task. Include code paths, findings, test results, or any info parent needs.",
      ),
  }),
  async execute(
    params,
    ctx,
  ): Promise<{
    title: string
    metadata: CompleteTaskMetadata
    output: string
  }> {
    const { summary, result } = params
    const { sessionID } = ctx

    log.info("task completion requested", {
      sessionID,
      summary,
      resultLength: result.length,
    })

    // 1. Get session info
    const session = await Session.get(sessionID)

    // 2. Check if this is actually a subtask
    if (!session.parentID) {
      log.warn("attempted to complete root task", { sessionID })
      throw new Error(
        "This is a root task, not a subtask. The complete_task tool can only be used in subtasks created by a parent orchestrator. Root tasks should complete naturally when work is done.",
      )
    }

    // 3. Get task depth for metadata
    const depth = await TaskHierarchy.getDepth(sessionID)

    // 4. Complete the subtask and resume parent
    await TaskHierarchy.completeSubtask(sessionID, result)

    log.info("task completed successfully", {
      sessionID,
      parentSessionID: session.parentID,
      summary,
      depth,
    })

    // 5. Return completion confirmation
    const output =
      `✅ Subtask completed: ${summary}\n\n` +
      `Results passed to parent task.\n\n` +
      `Parent task will now resume with your results.`

    return {
      title: `Completed: ${summary}`,
      metadata: {
        sessionID,
        parentSessionID: session.parentID,
        summary,
        depth,
      },
      output,
    }
  },
})
