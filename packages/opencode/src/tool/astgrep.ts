import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import path from "path"
import fs from "fs/promises"
import { minimatch } from "minimatch"

export const AstGrepTool = Tool.define("astgrep", {
  description: `🔍 STRUCTURAL CODE SEARCH - Parse and search code by Abstract Syntax Tree (AST) patterns

Use this tool when you need to:
• Find code structures (function definitions, type declarations, patterns) instead of text
• Perform type-aware refactoring (rename interfaces/functions without touching string literals)
• Search for complex patterns that regex can't handle safely
• Analyze code structure across the entire project

Key signals that this tool is perfect for your task:
- "Find all interface declarations"
- "Search for React component patterns" 
- "Refactor API calls safely"
- "Find unused imports"
- "Pattern matching on code structure"
- "Type-aware search"

Pattern syntax:
• $VAR - Match any single AST node (function name, type, etc.)
• $$$ - Match zero or more AST nodes
• \${...} - Match specific patterns

Examples:
• "type $NAME = $BODY" - Find all type aliases
• "interface $I { $$$ }" - Find interface declarations
• "console.log($MSG)" - Find all console.log calls`,
  parameters: z.object({
    pattern: z.string().describe(`AST pattern with meta-variables. Examples:
• "function $NAME($$$)" - Find function declarations
• "interface $I { $$$ }" - Find interfaces
• "type $T = $BODY" - Find type aliases
• "$OBJ.$METHOD($$$)" - Find method calls
• "export $DECLARATION" - Find exports
Use $VAR for single nodes, $$$ for zero-or-more nodes.`),
    lang: z.enum(["typescript", "javascript"]).describe("Language of code to search"),
    path: z
      .string()
      .optional()
      .describe("Directory to search (defaults to current working directory). Use for project-wide searches."),
    include: z.string().optional().describe("File pattern to include (e.g., '**/*.ts', 'src/**/*.js')"),
    exclude: z.string().optional().describe("Directories to exclude (comma-separated, e.g., 'node_modules,.git')"),
    context: z.number().optional().describe("Number of lines of context to show around matches (default: 0)"),
  }),

  async execute(params, context) {
    const astGrep = await import("@ast-grep/napi")

    const searchPath = params.path || Instance.directory

    // Map language strings to ast-grep language modules
    const langMap = {
      typescript: astGrep.ts,
      javascript: astGrep.js,
    }

    const lang = langMap[params.lang]
    if (!lang) {
      throw new Error(`Unsupported language: ${params.lang}`)
    }

    // Find source files
    const files = await findSourceFiles(searchPath, params.lang, params.include, params.exclude)
    const results = []
    const contextLines = params.context || 0
    const fileLinesCache = new Map<string, string[]>()

    for (const file of files) {
      try {
        let lines = fileLinesCache.get(file)
        if (!lines) {
          const content = await fs.readFile(file, "utf-8")
          lines = content.split("\n")
          fileLinesCache.set(file, lines)
        }
        const ast = lang.parse(lines.join("\n"))
        const root = ast.root()
        const matches = root.findAll(params.pattern)

        for (const match of matches) {
          const startLine = match.range().start.line + 1
          const endLine = match.range().end.line + 1
          const text = match.text()
          const metaVars = extractMetaVars(match, params.pattern)

          let context = ""
          if (contextLines > 0) {
            const start = Math.max(0, startLine - 1 - contextLines)
            const end = Math.min(lines.length, endLine + contextLines)
            context = lines.slice(start, end).join("\n")
          }

          results.push({
            file,
            line: startLine,
            text,
            metaVars,
            context,
          })
        }
      } catch (error) {
        continue
      }
    }

    const output = formatResults(results, params.pattern)
    return {
      title: `AST Search Results`,
      metadata: { pattern: params.pattern, lang: params.lang, matches: results.length },
      output,
    }
  },
})

async function findSourceFiles(
  searchPath: string,
  lang: string,
  include?: string,
  exclude?: string,
): Promise<string[]> {
  const { readdir } = fs
  const { join } = path
  const files: string[] = []

  const extensions = {
    typescript: [".ts", ".tsx"],
    javascript: [".js", ".jsx"],
  }

  const exts = extensions[lang as keyof typeof extensions] || extensions.typescript

  const excludeDirs = ["node_modules", ".git", "dist", "build", ".next", ".nuxt"]
  if (exclude) {
    excludeDirs.push(...exclude.split(",").map((s) => s.trim()))
  }

  async function scanDirectory(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await scanDirectory(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name)
          if (exts.includes(ext)) {
            files.push(fullPath)
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await scanDirectory(searchPath)

  // Filter by include pattern if provided
  let filtered = files
  if (include) {
    filtered = filtered.filter((file) => minimatch(path.relative(searchPath, file), include))
  }

  return filtered
}

function extractMetaVars(match: any, pattern: string): Record<string, string> {
  const metaVars: Record<string, string> = {}

  const singleVarMatches = pattern.match(/\$(\w+)/g)
  if (singleVarMatches) {
    for (const varMatch of singleVarMatches) {
      const varName = varMatch.substring(1)
      try {
        const matchedNode = match.getMatch(varName)
        if (matchedNode) {
          metaVars[varName] = matchedNode.text()
        }
      } catch (e) {
        // Ignore errors when extracting meta variables
      }
    }
  }

  const multiVarMatches = pattern.match(/\$\$\$(\w+)/g)
  if (multiVarMatches) {
    for (const varMatch of multiVarMatches) {
      const varName = varMatch.substring(3)
      try {
        const matchedNodes = match.getMultipleMatches(varName)
        if (matchedNodes && matchedNodes.length > 0) {
          metaVars[varName] = matchedNodes.map((node: any) => node.text()).join("")
        }
      } catch (e) {
        // Ignore errors when extracting meta variables
      }
    }
  }

  return metaVars
}

function formatResults(results: any[], pattern: string): string {
  if (results.length === 0) {
    return `No matches found for pattern: ${pattern}`
  }

  const output = [
    `Found ${results.length} matches for pattern: ${pattern}`,
    ...results.map(
      (result: any) =>
        `${result.file}:${result.line} - ${result.text}${
          Object.keys(result.metaVars).length > 0
            ? ` [${Object.entries(result.metaVars)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}]`
            : ""
        }${
          result.context
            ? `\n${result.context
                .split("\n")
                .map((line: string) => `  ${line}`)
                .join("\n")}`
            : ""
        }`,
    ),
  ]

  return output.join("\n")
}
