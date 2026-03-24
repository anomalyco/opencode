import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ast_grep.txt"
import { assertExternalDirectory } from "./external-directory"
import { AstLang, buildMatcher, resolveTarget, searchAst } from "./ast"
import { Filesystem } from "../util/filesystem"

const LIMIT = 100

export const AstGrepTool = Tool.define("ast_grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("AST pattern to search for"),
    lang: AstLang.describe("Language to parse: typescript, tsx, javascript, or jsx"),
    path: z.string().optional().describe("The file or directory to search in. Defaults to the current working directory."),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        lang: params.lang,
        path: params.path,
      },
    })

    const target = resolveTarget(params.path)
    const stat = Filesystem.stat(target)
    await assertExternalDirectory(ctx, target, { kind: stat?.isDirectory() ? "directory" : "file" })

    const hits = await searchAst({
      path: target,
      lang: params.lang,
      matcher: buildMatcher(params.lang, params.pattern),
      abort: ctx.abort,
    })

    if (hits.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, files: 0, truncated: false },
        output: "No files found",
      }
    }

    hits.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path) || a.line - b.line)

    const truncated = hits.length > LIMIT
    const list = truncated ? hits.slice(0, LIMIT) : hits
    const files = new Set(hits.map((item) => item.path)).size
    const out = [`Found ${hits.length} matches${truncated ? ` (showing first ${LIMIT})` : ""}`]

    let file = ""
    for (const item of list) {
      if (file !== item.path) {
        if (file !== "") out.push("")
        file = item.path
        out.push(`${item.path}:`)
      }
      out.push(`  Line ${item.line}: ${item.text}`)
    }

    if (truncated) {
      out.push("")
      out.push(
        `(Results truncated: showing ${LIMIT} of ${hits.length} matches (${hits.length - LIMIT} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    return {
      title: params.pattern,
      metadata: {
        matches: hits.length,
        files,
        truncated,
      },
      output: out.join("\n"),
    }
  },
})
