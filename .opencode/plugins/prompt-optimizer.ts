type Item = {
  info: {
    role: string
  }
  parts: {
    type: string
    text?: string
  }[]
}

type Client = {
  session: {
    messages(input: {
      path: {
        id: string
      }
      query: {
        limit: number
      }
    }): Promise<{
      data?: Item[]
    }>
  }
}

type Input = {
  id: string
  action: string
  context?: {
    prompt?: string
    sessionID?: string
  }
}

type Output = {
  values?: Record<string, unknown>
  action?: string
  cancelled?: boolean
}

/**
 * Prompt Optimizer Plugin
 *
 * This plugin provides a customizable prompt optimization hook.
 * By default, the TUI uses the built-in /tui/optimize-prompt endpoint
 * which uses AI to optimize prompts with conversation context.
 *
 * You can customize the optimization behavior by modifying this plugin.
 * To use this plugin instead of the built-in optimizer, change the frontend
 * to call /tui/ui-interact with action "prompt.optimize".
 */
export const PromptOptimizerPlugin = async ({ client }: { client: Client }) => {
  return {
    "tui.ui.interact": async (input: Input, output: Output) => {
      if (input.action !== "prompt.optimize") return

      const prompt = input.context?.prompt ?? ""
      const sessionID = input.context?.sessionID

      try {
        let ctx = ""
        if (sessionID) {
          const messages = await client.session.messages({
            path: { id: sessionID },
            query: { limit: 5 },
          })
          if (messages.data && messages.data.length > 0) {
            const recent = messages.data
              .slice(-3)
              .map((m) => {
                const role = m.info.role
                const text = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p.type === "text" ? (p.text ?? "").slice(0, 200) : ""))
                  .join(" ")
                return `${role}: ${text}`
              })
              .join("\n")
            ctx = `\n\nRecent context:\n${recent}`
          }
        }

        output.values = {
          original: prompt,
          optimized: buildOptimizedPrompt(prompt, ctx),
        }
        output.action = "optimized"
      } catch (err) {
        output.cancelled = true
        output.values = {
          error: err instanceof Error ? err.message : "Unknown error",
        }
      }
    },
  }
}

function buildOptimizedPrompt(prompt: string, context: string): string {
  const lines = ["I need help with the following task:", "", prompt]

  if (context) {
    lines.push("", "Context from our conversation:", context)
  }

  lines.push("", "Please provide a clear, detailed, and actionable response.")

  return lines.join("\n")
}

export default PromptOptimizerPlugin
