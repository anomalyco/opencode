import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./repo_architect.txt"
import { Instance as ProjectInstance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import * as path from "path"
import { Log } from "../util/log"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

export namespace RepoArchitectTool {
  const log = Log.create({ service: "repo-architect-tool" })

  const parser = lazy(async () => {
    const { Parser } = await import("web-tree-sitter")
    // We reuse the WASM loading logic from bash.ts if needed, but for now we simplify
    return new Parser()
  })

  export const Instance = Tool.define("repo_architect", {
    description: DESCRIPTION,
    parameters: z.object({
      directory: z.string().optional().describe("The directory to analyze"),
      depth: z.number().default(3).describe("Traversal depth"),
      format: z.enum(["text", "json", "mermaid"]).default("text").describe("Output format"),
    }),
    async execute(params, ctx) {
      const analyzeDir: string = params.directory || ProjectInstance.directory
      log.info("architecting repo", { analyzeDir, depth: params.depth })

      // Simplified repo architect that maps the structure
      const outputDescription: string = `Architecture map for ${analyzeDir} (depth: ${params.depth}):\n\n- packages/\n  - opencode/ (core engine)\n  - sdk/ (JS client)\n- .agents/ (workflows)\n\n(This is a placeholder for the AST-mapped skeleton)`
      
      return {
        title: "Repository Architecture",
        output: outputDescription,
        metadata: params,
      }
    },
  })
}

export const RepoArchitectToolDefinition = RepoArchitectTool.Instance
