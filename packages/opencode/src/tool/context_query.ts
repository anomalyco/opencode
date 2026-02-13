import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./context_query.txt"
import * as RLMContext from "@/rlm/context"

export const ContextQueryTool = Tool.define("context_query", {
  description: DESCRIPTION,
  parameters: z.object({
    code: z
      .string()
      .describe(
        "JavaScript code to execute against the context memory. The `context` variable is an array of all conversation entries. Use console.log() to output results.",
      ),
  }),
  async execute(params, ctx) {
    const result = await RLMContext.execute(ctx.sessionID, params.code)

    const output = [
      result.stdout ? result.stdout.trim() : "",
      result.stderr ? `[stderr] ${result.stderr.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const locals = Object.entries(result.locals)
      .filter(([k]) => k !== "context")
      .map(([k, v]) => `${k} = ${v}`)
      .join(", ")

    const footer = locals ? `\n[variables: ${locals}]` : ""

    return {
      title: "context_query",
      metadata: {
        executionTime: result.executionTime,
      },
      output: (output || "(no output)") + footer,
    }
  },
})
