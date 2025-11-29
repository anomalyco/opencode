import { Permission } from "../permission"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

// Plan types - matching the gitlab-ai-provider types
export interface PlanStep {
  id?: string
  title: string
  description?: string
  status?: "pending" | "in_progress" | "completed" | "failed"
}

export interface PlanInfo {
  steps: PlanStep[]
  goal?: string
  summary?: string
}

export interface PlanApprovalResult {
  approved: boolean
  feedback?: string
}

const log = Log.create({ service: "gitlab-plan-approval" })

/**
 * Context for plan approval - set by the session processor before each prompt
 * Includes Instance directory for AsyncLocalStorage context restoration
 */
let currentContext: {
  sessionID: string
  messageID: string
  directory: string
} | null = null

/**
 * Set the current context for plan approval
 * Called by the session processor before invoking the model
 */
export function setContext(ctx: { sessionID: string; messageID: string }) {
  log.info("Setting plan approval context", ctx)
  // Capture the Instance directory so we can restore it when callback is invoked
  currentContext = {
    ...ctx,
    directory: Instance.directory,
  }
}

/**
 * Clear the current context
 */
export function clearContext() {
  currentContext = null
}

/**
 * Format plan steps as human-readable text
 */
function formatPlanSteps(plan: PlanInfo): string {
  const lines: string[] = []
  
  if (plan.goal) {
    lines.push(`Goal: ${plan.goal}`)
  }
  
  if (plan.summary) {
    lines.push(`Summary: ${plan.summary}`)
  }
  
  if (plan.steps && plan.steps.length > 0) {
    lines.push("Steps:")
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      lines.push(`  ${i + 1}. ${step.title}`)
      if (step.description) {
        lines.push(`     ${step.description}`)
      }
    }
  }
  
  return lines.join("\n")
}

/**
 * Handle plan approval using the opencode Permission system
 * This is called by the GitLab LSP model when a plan needs approval
 * 
 * IMPORTANT: This callback is invoked from outside the AsyncLocalStorage context
 * (from Socket.IO event handlers in the gitlab-ai-provider). We must restore
 * the Instance context before calling Permission.ask().
 */
export async function handlePlanApproval(
  plan: PlanInfo,
  workflowId: string
): Promise<PlanApprovalResult> {
  log.info("Plan approval requested", { workflowId, plan })
  
  if (!currentContext) {
    log.warn("No context set for plan approval, auto-approving")
    return { approved: true }
  }
  
  const { sessionID, messageID, directory } = currentContext
  
  // Run within the Instance context to ensure AsyncLocalStorage is available
  // This is necessary because the callback is invoked from outside the context
  // (from gitlab-lsp-agentic-model's Socket.IO event handlers)
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        // Use the Permission system to prompt the user
        await Permission.ask({
          type: "plan_approval",
          title: `Approve GitLab Duo Workflow Plan`,
          pattern: workflowId,
          sessionID,
          messageID,
          metadata: {
            workflowId,
            goal: plan.goal,
            summary: plan.summary,
            steps: plan.steps,
            formattedPlan: formatPlanSteps(plan),
          },
        })
        
        // If we get here, the user approved the plan
        log.info("Plan approved by user", { workflowId })
        return { approved: true }
        
      } catch (error) {
        // Permission was rejected
        if (error instanceof Permission.RejectedError) {
          log.info("Plan rejected by user", { workflowId, reason: error.reason })
          return {
            approved: false,
            feedback: error.reason || "Plan was rejected by user",
          }
        }
        
        // Other error - treat as rejection
        log.error("Plan approval error", { workflowId, error })
        return {
          approved: false,
          feedback: `Error during plan approval: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  })
}

/**
 * Handle workflow status change
 */
export function handleStatusChange(status: string, workflowId: string) {
  log.info("Workflow status changed", { workflowId, status })
}
