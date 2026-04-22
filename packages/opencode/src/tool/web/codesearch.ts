import z from "zod"
import { Tool } from "../shared/tool"
import { callExa } from "./exa"

const DESCRIPTION = `- Search and get relevant context for any programming task using Exa Code API
- Provides the highest quality and freshest context for libraries, SDKs, and APIs
- Use this tool for ANY question or task related to programming
- Returns comprehensive code examples, documentation, and API references
- Optimized for finding specific programming patterns and solutions

Usage notes:
  - Adjustable token count (1000-50000) for focused or comprehensive results
  - Default 5000 tokens provides balanced context for most queries
  - Use lower values for specific questions, higher values for comprehensive documentation
  - Supports queries about frameworks, libraries, APIs, and programming concepts
  - Examples: 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware'`

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    const output = await callExa({
      name: "get_code_context_exa",
      args: {
        query: params.query,
        tokensNum: params.tokensNum || 5000,
      },
      timeout: 30000,
      abort: ctx.abort,
    })

    return output
      ? {
          output,
          title: `Code search: ${params.query}`,
          metadata: {},
        }
      : {
          output:
            "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
          title: `Code search: ${params.query}`,
          metadata: {},
        }
  },
})
