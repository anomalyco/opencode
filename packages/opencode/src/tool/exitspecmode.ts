import z from "zod/v4"
import { Tool } from "./tool"
import DESCRIPTION from "./exitspecmode.txt"
import { getSpecState } from "./specmode"

export const ExitSpecModeTool = Tool.define("exitspecmode", {
  description: DESCRIPTION,
  parameters: z.object({
    plan: z.string().describe("The markdown-formatted plan you came up with"),
    title: z.string().optional().describe("Optional title for the plan"),
    include_context: z
      .boolean()
      .optional()
      .describe("Include requirements and notes from SpecMode (default true)"),
  }),
  async execute(params, ctx) {
    const specSessions = getSpecState()
    const session = specSessions[ctx.sessionID]

    // Check if in spec mode
    if (!session?.active) {
      // Allow exiting even if not in spec mode, but warn
      return {
        title: params.title || "Implementation Plan",
        output:
          "⚠️ Warning: Not currently in spec mode\n\n" + params.plan,
        metadata: {
          was_in_spec_mode: false,
          requirements_count: 0,
          notes_count: 0,
          duration_seconds: 0,
        },
      }
    }

    const includeContext = params.include_context !== false

    // Build output with optional context
    let output = ""

    if (includeContext && (session.requirements.length > 0 || session.notes.length > 0)) {
      output += "## Spec Context\n\n"

      if (session.requirements.length > 0) {
        output += "### Requirements\n"
        session.requirements.forEach((req, i) => {
          output += `${i + 1}. ${req}\n`
        })
        output += "\n"
      }

      if (session.notes.length > 0) {
        output += "### Planning Notes\n"
        session.notes.forEach((note, i) => {
          output += `${i + 1}. ${note}\n`
        })
        output += "\n"
      }

      output += "---\n\n"
    }

    output += params.plan

    // Deactivate spec mode
    session.active = false

    const title = params.title || "Implementation Plan"

    return {
      title,
      output,
      metadata: {
        was_in_spec_mode: true,
        requirements_count: session.requirements.length,
        notes_count: session.notes.length,
        duration_seconds: Math.floor((Date.now() - session.startedAt) / 1000),
      },
    }
  },
})
