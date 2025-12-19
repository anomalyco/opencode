import z from "zod"
import { Tool } from "./tool"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { MorphClient } from "@morphllm/morphsdk"
import DESCRIPTION from "./warpgrep.txt"

export const WarpGrepTool = Tool.define("warpgrep", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      query: z.string().describe("Natural language query about the codebase"),
      path: z.string().optional().describe("Directory to scope the search (defaults to workspace root)"),
    }),
    async execute(args, ctx) {
      const auth = await Auth.get("morph")
      const apiKey = auth?.type === "api" ? auth.key : Env.get("MORPH_API_KEY")
      if (!apiKey) {
        throw new Error("Morph API key not configured. Set MORPH_API_KEY or run 'opencode auth login' and select 'Other' → 'morph'.")
      }

      const morph = new MorphClient({ apiKey })

      const result = await morph.warpGrep.execute({
        query: args.query,
        repoRoot: args.path ?? Instance.directory,
      })

      if (!result.success) {
        return {
          title: args.query,
          output: result.error ?? "Search failed",
          metadata: { count: 0 },
        }
      }

      if (!result.contexts || result.contexts.length === 0) {
        return {
          title: args.query,
          output: "No relevant code found for the query.",
          metadata: { count: 0 },
        }
      }

      const output = result.contexts
        .map((c) => `### ${c.file}\n\`\`\`\n${c.content}\n\`\`\``)
        .join("\n\n")

      return {
        title: args.query,
        output,
        metadata: { count: result.contexts.length },
      }
    },
  }
})

