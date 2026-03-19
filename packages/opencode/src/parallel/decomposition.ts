import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { Glob } from "@/util/glob"
import { SubtaskID } from "./schema"
import type { Subtask, ModelRef } from "./schema"
import path from "path"

export namespace Decomposition {
  const log = Log.create({ service: "decomposition" })

  export const SYSTEM_PROMPT = `You are a task decomposition agent for a parallel coding system.

Given a user's task, break it down into subtasks that can be executed in parallel by separate coding agents. Each agent will work in an isolated git worktree branched from the same HEAD.

Rules:
1. Each subtask MUST touch a different set of files where possible. File overlap causes merge conflicts.
2. Each subtask must be self-contained — the worker agent receives ONLY the global task description and its specific subtask, nothing else.
3. Each subtask should be small enough for a single agent session (under ~500 lines changed).
4. Include a clear fileScope listing which files/directories the subtask should modify.
5. If a task cannot be meaningfully parallelized (e.g., a single-file bug fix), return exactly ONE subtask.
6. Subtask descriptions should be detailed enough for an agent to execute without ambiguity.
7. Use the dependencies field to specify when one subtask must complete before another can start. Reference dependencies by the 0-based index of the subtask they depend on (e.g., 0, 1, 2).
8. Avoid circular dependencies - the dependency graph must be acyclic.
9. If subtasks are truly independent, leave dependencies empty.

Output format: a JSON object with a "subtasks" array.`

  const SubtaskOutput = z.object({
    title: z.string().describe("Short label for the subtask, e.g., 'Add login form'"),
    description: z.string().describe("Full instructions for the worker agent"),
    fileScope: z.array(z.string()).describe("Files/directories this subtask should modify"),
    dependencies: z
      .array(z.number())
      .describe(
        "0-based indices of subtasks that must complete before this one (leave empty for independent subtasks)",
      ),
  })

  const OutputSchema = z.object({
    subtasks: z.array(SubtaskOutput),
  })

  export interface CodebaseContext {
    root: string
    fileCount: number
    directories: string[]
    keyFiles: { path: string; type: string }[]
    techStack: string[]
    structure: string
  }

  export async function gatherCodebaseContext(root: string): Promise<CodebaseContext> {
    log.info("gathering codebase context", { root })

    const directories = new Set<string>()
    const keyFiles: { path: string; type: string }[] = []
    const techStack = new Set<string>()

    const allFiles = await Glob.scan("**/*", {
      cwd: root,
      dot: true,
      include: "file",
    })

    const IGNORE_PATTERNS = [/node_modules/, /\.git/, /dist/, /build/, /\.next/, /coverage/, /\.log$/]

    const KEY_FILES = [
      { pattern: /package\.json$/, type: "package" },
      { pattern: /tsconfig\.json$/, type: "typescript" },
      { pattern: /jsconfig\.json$/, type: "javascript" },
      { pattern: /vite\.config\./, type: "vite" },
      { pattern: /webpack\.config\./, type: "webpack" },
      { pattern: /rollup\.config\./, type: "rollup" },
      { pattern: /esbuild\.config\./, type: "esbuild" },
      { pattern: /next\.config\./, type: "next" },
      { pattern: /astro\.config\./, type: "astro" },
      { pattern: /svelte\.config\./, type: "svelte" },
      { pattern: /nuxt\.config\./, type: "nuxt" },
      { pattern: /tailwind\.config\./, type: "tailwind" },
      { pattern: /postcss\.config\./, type: "postcss" },
      { pattern: /jest\.config\./, type: "jest" },
      { pattern: /vitest\.config\./, type: "vitest" },
      { pattern: /playwright\.config\./, type: "playwright" },
      { pattern: /cypress\.config\./, type: "cypress" },
      { pattern: /dockerfile$/i, type: "docker" },
      { pattern: /docker-compose/, type: "docker-compose" },
      { pattern: /\.github\//, type: "github" },
      { pattern: /Makefile$/, type: "make" },
      { pattern: /Cargo\.toml$/, type: "cargo" },
      { pattern: /go\.mod$/, type: "go" },
      { pattern: /pyproject\.toml$/, type: "python" },
      { pattern: /requirements\.txt$/, type: "python" },
      { pattern: /Pipfile$/, type: "python" },
      { pattern: /Gemfile$/, type: "ruby" },
      { pattern: /composer\.json$/, type: "php" },
      { pattern: /pom\.xml$/, type: "java" },
      { pattern: /build\.gradle$/, type: "java" },
    ]

    const filteredFiles: string[] = []
    for (const file of allFiles) {
      if (IGNORE_PATTERNS.some((p) => p.test(file))) continue
      filteredFiles.push(file)

      const dir = path.dirname(file)
      if (dir !== "." && !dir.startsWith("node_modules") && !dir.startsWith(".git")) {
        directories.add(dir.split("/")[0])
      }

      for (const { pattern, type } of KEY_FILES) {
        if (pattern.test(file)) {
          keyFiles.push({ path: file, type })
          if (["package", "typescript", "javascript"].includes(type)) {
            techStack.add(type)
          }
          if (["vite", "webpack", "rollup", "esbuild"].includes(type)) {
            techStack.add("bundler")
          }
          if (["next", "astro", "svelte", "nuxt"].includes(type)) {
            techStack.add("framework")
            techStack.add(type)
          }
        }
      }

      if (file.endsWith(".tsx") || file.endsWith(".jsx")) {
        techStack.add("react")
      }
      if (file.endsWith(".vue")) {
        techStack.add("vue")
      }
      if (file.endsWith(".svelte")) {
        techStack.add("svelte")
      }
      if (file.endsWith(".ts")) {
        techStack.add("typescript")
      }
      if (file.endsWith(".js")) {
        techStack.add("javascript")
      }
      if (file.endsWith(".py")) {
        techStack.add("python")
      }
      if (file.endsWith(".go")) {
        techStack.add("go")
      }
      if (file.endsWith(".rs")) {
        techStack.add("rust")
      }
    }

    const srcFiles = filteredFiles.filter((f: string) => {
      const ext = path.extname(f)
      return [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".vue",
        ".svelte",
        ".py",
        ".go",
        ".rs",
        ".java",
        ".kt",
        ".rb",
        ".php",
      ].includes(ext)
    })

    const maxSample = 20
    const structure = srcFiles.slice(0, maxSample).join("\n")

    log.info("codebase context gathered", {
      fileCount: filteredFiles.length,
      dirCount: directories.size,
      keyFileCount: keyFiles.length,
      techCount: techStack.size,
    })

    return {
      root,
      fileCount: filteredFiles.length,
      directories: Array.from(directories).slice(0, 50),
      keyFiles: keyFiles.slice(0, 20),
      techStack: Array.from(techStack),
      structure,
    }
  }

  export function formatCodebaseContext(ctx: CodebaseContext): string {
    const lines: string[] = [
      `Project Root: ${ctx.root}`,
      `Total Files: ${ctx.fileCount}`,
      ``,
      `Technology Stack:`,
      ...ctx.techStack.map((t) => `  - ${t}`),
      ``,
      `Key Configuration Files:`,
      ...ctx.keyFiles.map((kf) => `  - ${kf.path} (${kf.type})`),
      ``,
      `Top-Level Directories:`,
      ...ctx.directories.map((d) => `  - ${d}/`),
      ``,
      `Sample Source Files (${Math.min(20, ctx.fileCount)} shown):`,
      ctx.structure || "  (No source files found)",
    ]

    return lines.join("\n")
  }

  export interface DependencyError {
    type: "circular" | "invalid" | "self"
    subtaskIndex: number
    details: string
  }

  export function validateDependencies(subtasks: { dependencies: number[] }[]): DependencyError | undefined {
    const n = subtasks.length

    for (let i = 0; i < n; i++) {
      for (const dep of subtasks[i].dependencies) {
        if (dep < 0 || dep >= n) {
          return {
            type: "invalid",
            subtaskIndex: i,
            details: `Dependency ${dep} out of range (valid: 0-${n - 1})`,
          }
        }
        if (dep === i) {
          return {
            type: "self",
            subtaskIndex: i,
            details: `Subtask ${i} depends on itself`,
          }
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<number>()
    const recStack = new Set<number>()

    function hasCycle(node: number): boolean {
      visited.add(node)
      recStack.add(node)

      for (const dep of subtasks[node].dependencies) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true
        } else if (recStack.has(dep)) {
          return true
        }
      }

      recStack.delete(node)
      return false
    }

    for (let i = 0; i < n; i++) {
      if (!visited.has(i)) {
        if (hasCycle(i)) {
          return {
            type: "circular",
            subtaskIndex: i,
            details: `Circular dependency detected involving subtask ${i}`,
          }
        }
      }
    }

    return undefined
  }

  export function topologicalSort<T extends { dependencies: number[] }>(
    subtasks: T[],
  ): { order: number[]; levels: number[] } {
    const n = subtasks.length
    const inDegree = new Array(n).fill(0)
    const adj = Array.from({ length: n }, () => [] as number[])

    for (let i = 0; i < n; i++) {
      for (const dep of subtasks[i].dependencies) {
        adj[dep].push(i)
        inDegree[i]++
      }
    }

    const queue: number[] = []
    const levels = new Array(n).fill(0)

    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) {
        queue.push(i)
        levels[i] = 0
      }
    }

    const order: number[] = []

    while (queue.length > 0) {
      const u = queue.shift()!
      order.push(u)

      for (const v of adj[u]) {
        inDegree[v]--
        if (inDegree[v] === 0) {
          queue.push(v)
          levels[v] = levels[u] + 1
        }
      }
    }

    if (order.length !== n) {
      throw new Error("Cycle detected in dependency graph")
    }

    return { order, levels }
  }

  export function assignSubtaskIDs<
    T extends { title: string; description: string; fileScope: string[]; dependencies: number[] },
  >(subtasks: T[]): Subtask[] {
    const n = subtasks.length
    const ids = Array.from({ length: n }, () => SubtaskID.ascending())

    return subtasks.map((st, i) => ({
      id: ids[i],
      title: st.title,
      description: st.description,
      fileScope: st.fileScope,
      dependencies: st.dependencies.map((depIdx) => ids[depIdx]),
    }))
  }

  export async function decompose(input: {
    task: string
    model: ModelRef
    codebaseContext?: string
  }): Promise<Subtask[]> {
    log.info("decomposing task", { task: input.task.slice(0, 100) })

    const fullModel = await Provider.getModel(input.model.providerID, input.model.modelID)
    const language = await Provider.getLanguage(fullModel)

    const userContent = input.codebaseContext
      ? `## Task\n${input.task}\n\n## Codebase Context\n${input.codebaseContext}`
      : input.task

    const result = await generateObject({
      model: language,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      schema: OutputSchema,
    })

    const depError = validateDependencies(result.object.subtasks)
    if (depError) {
      log.error("dependency validation failed", depError)
      throw new Error(`Invalid dependencies: ${depError.type} - ${depError.details}`)
    }

    const subtasks = assignSubtaskIDs(result.object.subtasks)

    log.info("decomposition complete", { count: subtasks.length })
    return subtasks
  }
}
