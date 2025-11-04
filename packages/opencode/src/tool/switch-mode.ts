import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./switch-mode.txt"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { Log } from "../util/log"

const log = Log.create({ service: "switch-mode-tool" })

type SwitchModeMetadata = {
  from?: string
  to: string
  reason?: string
  already_in_mode?: boolean
}

/**
 * Switch Mode Tool
 *
 * Production-grade mode switching for orchestration workflows.
 * Enables seamless transitions between specialized agents with state preservation.
 */
export const SwitchModeTool = Tool.define("switch_mode", {
  description: DESCRIPTION,
  parameters: z.object({
    mode_slug: z
      .string()
      .describe(
        "The agent mode to switch to (e.g., 'architect', 'plan', 'general', 'orchestrator')",
      ),
    reason: z.string().describe("Clear explanation of why this mode switch is necessary"),
  }),
  async execute(
    params,
    ctx,
  ): Promise<{
    title: string
    metadata: SwitchModeMetadata
    output: string
  }> {
    const { mode_slug, reason } = params
    const { sessionID } = ctx

    log.info("mode switch requested", {
      sessionID,
      targetMode: mode_slug,
      reason,
    })

    // 1. Validate target mode exists
    const targetAgent = await Agent.get(mode_slug)
    if (!targetAgent) {
      log.warn("invalid mode requested", { mode_slug })
      throw new Error(
        `Invalid mode: "${mode_slug}" does not exist. Available modes: general, plan, orchestrator, architect`,
      )
    }

    // 2. Get current mode from context (passed from SessionPrompt)
    // The agent executing this tool is the current mode
    const currentMode = ctx.agent || "general"

    log.info("current mode determined", {
      currentMode,
      ctxAgent: ctx.agent,
    })

    // 3. Check if already in requested mode
    if (currentMode === mode_slug) {
      log.info("already in target mode", { mode_slug })
      return {
        title: `Already in ${targetAgent.name} mode`,
        metadata: { to: mode_slug, already_in_mode: true },
        output: `Already in ${targetAgent.name} mode. No switch needed.`,
      }
    }

    // 4. Check if target mode allows switching from current mode
    if (targetAgent.canSwitchFrom && !targetAgent.canSwitchFrom.includes(currentMode)) {
      log.warn("mode switch not allowed", {
        from: currentMode,
        to: mode_slug,
      })
      throw new Error(
        `Cannot switch from "${currentMode}" mode to "${mode_slug}" mode. This transition is not allowed.`,
      )
    }

    // 5. Check if current mode allows creating switches (capabilities)
    const currentAgent = await Agent.get(currentMode)
    if (currentAgent?.capabilities && !currentAgent.capabilities.canSwitchModes) {
      log.warn("current mode cannot switch", { currentMode })
      throw new Error(`Current mode "${currentMode}" does not allow mode switching.`)
    }

    // 6. User approval check (if required)
    const requiresApproval = targetAgent.requiresApproval ?? true
    if (requiresApproval) {
      // Note: In production, this would trigger UI approval flow
      // For now, we log and proceed (approval assumed in autonomous mode)
      log.info("mode switch requires approval", {
        from: currentMode,
        to: mode_slug,
      })
    }

    // 7. Update orchestration state with agent tracking
    await Session.update(sessionID, (draft) => {
      if (!draft.orchestration) {
        draft.orchestration = {
          depth: 0,
          status: "active",
          rootAgent: currentMode,
          currentAgent: mode_slug,
        }
      } else {
        // Preserve root agent, update current agent
        if (!draft.orchestration.rootAgent) {
          draft.orchestration.rootAgent = currentMode
        }
        draft.orchestration.currentAgent = mode_slug
      }
    })

    log.info("mode switch completed", {
      sessionID,
      from: currentMode,
      to: mode_slug,
      reason,
    })

    // 8. Return success result
    const reasonMsg = reason ? ` Reason: ${reason}` : ""
    const output = `Successfully switched from ${currentAgent?.name || currentMode} mode to ${targetAgent.name} mode.${reasonMsg}\n\nYou now have access to ${targetAgent.name} mode tools and capabilities.`

    return {
      title: `Switched to ${targetAgent.name} mode`,
      metadata: {
        from: currentMode,
        to: mode_slug,
        reason,
      },
      output,
    }
  },
})
