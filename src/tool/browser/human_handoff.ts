import z from "zod"
import { Tool } from "../tool"

/**
 * Special tool for browser agent to pause and request human help
 * when encountering auth, login, payment, captcha, or other
 * situations that require human attention.
 *
 * This is the ONLY way auto mode communicates with the user.
 */
export const BrowserHumanHandoffTool = Tool.define("browser_human_handoff", {
  description: `Pause the automation and ask the human user for help. Use this ONLY when you encounter a situation that requires human intervention:

- Sign-in / Login pages that need the user's credentials
- Two-factor authentication (2FA/MFA) prompts
- CAPTCHA challenges
- Payment / checkout pages that need payment details
- Cookie consent or age verification dialogs
- OAuth authorization screens ("Allow access?")
- Any security verification the agent cannot handle

When you call this tool, the agent pauses and waits for the human to complete the action in the headed browser window. After the human signals they are done, the agent resumes from where it left off.

DO NOT use this tool for anything else. Do not use it to ask questions, get clarification, or chat. Only for situations where the human must physically interact with the browser.`,
  parameters: z.object({
    reason: z.enum([
      "login",
      "two_factor_auth",
      "captcha",
      "payment",
      "cookie_consent",
      "oauth",
      "security_verification",
      "other_auth",
    ]).describe("The type of human intervention needed."),
    description: z.string().describe("Brief description of what the human needs to do (e.g., 'Please log in with your credentials', 'Please complete the CAPTCHA')."),
    url: z.string().optional().describe("The current page URL where intervention is needed."),
  }),
  async execute(params, ctx) {
    // This uses the permission system's ask() to pause and get human attention.
    // The "ask" permission triggers the TUI/UI to show a prompt to the user.
    await ctx.ask({
      permission: "browser_human_handoff",
      patterns: [params.reason],
      always: [],
      metadata: {
        reason: params.reason,
        description: params.description,
        url: params.url,
      },
    })

    ctx.metadata({
      title: `⏸ Waiting for human: ${params.reason}`,
      metadata: { reason: params.reason },
    })

    // After permission is granted (human says they're done), get fresh snapshot
    const { BrowserClient } = await import("../../browser/client")
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    const { BrowserState } = await import("../../browser/state")
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Human completed: ${params.reason}`,
      metadata: { reason: params.reason },
      output: `Human intervention completed (${params.reason}: ${params.description}).\nThe user has finished. Resuming automation.\n\n--- Current Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
