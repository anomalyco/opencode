import z from "zod"
import { Tool } from "../tool"

const MAX_WAIT_POLLS = 60 // 60 polls * 3s = 3 minutes max wait
const POLL_INTERVAL = 3000 // 3 seconds between page-change checks

/**
 * Special tool for browser agent to pause and request human help
 * when encountering auth, login, payment, captcha, or other
 * situations that require human attention.
 *
 * This is the ONLY way auto mode communicates with the user.
 *
 * After the user approves the permission prompt, the tool waits
 * for the page to actually change (URL or content change) before
 * resuming — this prevents the infinite handoff loop.
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

When you call this tool, the agent pauses and waits for the human to complete the action in the headed browser window. The tool automatically waits until the page changes (URL or content changes) before resuming.

DO NOT call this tool more than once for the same login/auth page. If the page hasn't changed after one handoff, report the issue and move on — do not loop.

DO NOT use this tool for anything else. Only for situations where the human must physically interact with the browser.`,
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
    const { BrowserClient } = await import("../../browser/client")
    const { BrowserState } = await import("../../browser/state")

    // Capture current page state BEFORE asking the human
    const beforeUrl = await BrowserClient.exec(ctx.sessionID, ["get", "url"], { abort: ctx.abort })
      .then((r) => r.output.trim())
      .catch(() => "")
    const beforeSnapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, compact: true, abort: ctx.abort })
      .then((r) => r.output.slice(0, 500))
      .catch(() => "")

    // Pause and ask the human
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

    // Wait for the page to ACTUALLY change — not just for the permission approval.
    // Poll every 3s for up to 3 minutes. The human is logging in / solving captcha
    // in the headed browser window during this time.
    let pageChanged = false
    for (let i = 0; i < MAX_WAIT_POLLS; i++) {
      if (ctx.abort.aborted) break

      const currentUrl = await BrowserClient.exec(ctx.sessionID, ["get", "url"], { abort: ctx.abort })
        .then((r) => r.output.trim())
        .catch(() => "")

      // Check if URL changed (e.g., from /login to /feed)
      if (currentUrl && beforeUrl && currentUrl !== beforeUrl) {
        pageChanged = true
        break
      }

      // Check if page content changed significantly
      const currentSnapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, compact: true, abort: ctx.abort })
        .then((r) => r.output.slice(0, 500))
        .catch(() => "")

      if (currentSnapshot && beforeSnapshot && currentSnapshot !== beforeSnapshot) {
        pageChanged = true
        break
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }

    // Get fresh snapshot after the human is done
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    if (!pageChanged) {
      return {
        title: `Human handoff: ${params.reason} (page unchanged)`,
        metadata: { reason: params.reason, pageChanged: false },
        output: `Human was asked to handle ${params.reason}, but the page did not change after waiting. The user may not have completed the action, or the page requires a different approach. Do NOT call browser_human_handoff again for this same page. Try a different strategy or report that this step could not be completed.\n\n--- Current Page Snapshot ---\n${snapshot.output}`,
      }
    }

    return {
      title: `Human completed: ${params.reason}`,
      metadata: { reason: params.reason, pageChanged: true },
      output: `Human intervention completed (${params.reason}: ${params.description}). The page has changed — resuming automation.\n\n--- Current Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
