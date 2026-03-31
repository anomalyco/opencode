import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { Glob } from "@/util/glob"
import { SubtaskID, type PlanID } from "./schema"
import type { Subtask, ModelRef, SharedContract, ProjectConventions, SubtaskKind } from "./schema"
import { Metrics } from "./metrics"
import { Bus } from "@/bus"
import { ParallelEvent } from "./events"
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
10. When subtasks share an interface boundary (API producer + consumer, shared types, config contracts), define SHARED CONTRACTS with exact type definitions that both sides must conform to. This prevents mismatches when workers implement independently.
11. Identify NEGATIVE CONSTRAINTS — things each subtask must NOT do (forbidden libraries, services, patterns). Attach relevant constraints to each subtask.
12. Identify PROJECT CONVENTIONS all workers must follow: serialization format, auth mechanism, timestamp format, naming conventions. Omit if the task is simple enough not to need cross-cutting conventions.
13. Classify each subtask with kind="structural" when the work is a mechanical rename/move/replace/path update that should favor direct file operations over deep code analysis. Use kind="semantic" for behavior changes or feature work.
14. For simple structural refactors, prefer the minimum number of subtasks, often exactly one. Do not split identical rename/replace work across many workers.

Output format: a JSON object with "subtasks" array, optional "sharedContracts" array, and optional "conventions" object.`

  const SubtaskOutput = z.object({
    title: z.string().describe("Short label for the subtask, e.g., 'Add login form'"),
    description: z.string().describe("Full instructions for the worker agent"),
    fileScope: z.array(z.string()).describe("Files/directories this subtask should modify"),
    dependencies: z
      .array(z.number())
      .describe(
        "0-based indices of subtasks that must complete before this one (leave empty for independent subtasks)",
      ),
    constraints: z
      .array(z.string())
      .optional()
      .describe("Things this subtask must NOT do — forbidden libs, patterns, services"),
    kind: z
      .enum(["semantic", "structural"])
      .optional()
      .describe("Use 'structural' for mechanical rename/move/replace tasks, otherwise 'semantic'"),
  })

  const OutputSchema = z.object({
    subtasks: z.array(SubtaskOutput),
    sharedContracts: z
      .array(
        z.object({
          name: z.string().describe("Contract name, e.g., 'OrganizeEndpoint API Contract'"),
          description: z.string().describe("What this contract covers"),
          types: z.string().describe("Exact type definitions both sides must use"),
          producerIndices: z.array(z.number().int().nonnegative()).describe("0-based subtask indices that implement this"),
          consumerIndices: z.array(z.number().int().nonnegative()).describe("0-based subtask indices that consume this"),
        }),
      )
      .optional()
      .describe("Shared type contracts for producer/consumer subtask pairs"),
    conventions: z
      .object({
        serialization: z.string().optional(),
        auth: z.string().optional(),
        timestamps: z.string().optional(),
        naming: z.string().optional(),
        other: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Cross-cutting conventions all workers must follow"),
  })

  export interface CodebaseContext {
    root: string
    fileCount: number
    directories: string[]
    keyFiles: { path: string; type: string }[]
    techStack: string[]
    structure: string
  }

  export interface Profile {
    kind: SubtaskKind
    simple: boolean
    reason: string
  }

  const STRUCTURAL = [
    /\brename\b.*\b(package|namespace|import|path|folder|directory|file|symbol|identifier)\b/,
    /\b(move|relocate)\b.*\b(file|folder|directory|package|namespace)\b/,
    /\b(update|rewrite|fix)\b.*\b(imports?|paths?|namespace|package)\b/,
    /\b(search(?:-| )and(?:-| )replace)\b/,
    /\breplace\b.+\bwith\b.+/,
    /\bpackage\b.+\bto\b.+/,
  ]

  const SEMANTIC = [
    /\b(add|build|create|implement)\b.*\b(feature|endpoint|workflow|screen|page|service|logic|support)\b/,
    /\bfix\b.*\b(bug|crash|logic|behavior|runtime)\b/,
    /\b(refactor|migrate)\b.*\b(api|architecture|state|auth|database|schema|component|service)\b/,
  ]

  function uniq(input: string[]) {
    return Array.from(new Set(input.filter(Boolean))).sort()
  }

  function title(task: string, subtasks: { title: string }[]) {
    const text = task.trim()
    if (text) return text.length > 80 ? `${text.slice(0, 77)}...` : text
    return subtasks[0]?.title || "Apply structural refactor"
  }

  function describe(task: string) {
    return [
      `Apply the requested structural refactor: ${task}`,
      "Use direct file moves and bulk search/replace where possible.",
      "Keep behavior unchanged while updating imports, package names, paths, and build/config references in scope.",
      "Verify the old identifier no longer appears in the touched files unless an intentional exception is required.",
    ].join("\n")
  }

  export function profile(task: string): Profile {
    const text = task.toLowerCase()
    const structural = STRUCTURAL.some((pattern) => pattern.test(text))
    const semantic = SEMANTIC.some((pattern) => pattern.test(text))

    if (structural && !semantic) {
      return {
        kind: "structural",
        simple: true,
        reason: "Task looks like a mechanical rename/move/replace refactor.",
      }
    }

    return {
      kind: "semantic",
      simple: false,
      reason: "Task likely needs behavioral understanding or implementation work.",
    }
  }

  export function simplify(subtasks: Subtask[], task: string, mode: Profile): Subtask[] {
    if (mode.kind !== "structural" || !mode.simple || subtasks.length <= 1) return subtasks
    return [
      {
        id: SubtaskID.ascending(),
        title: title(task, subtasks),
        description: describe(task),
        fileScope: uniq(subtasks.flatMap((subtask) => subtask.fileScope)),
        dependencies: [],
        constraints: uniq(subtasks.flatMap((subtask) => subtask.constraints ?? [])),
        kind: "structural",
      },
    ]
  }

  export async function gatherCodebaseContext(root: string, mode?: Profile): Promise<CodebaseContext> {
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

    const maxSample = mode?.kind === "structural" ? 0 : 20
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
    ]

    if (ctx.structure) {
      lines.push("", `Sample Source Files (${Math.min(20, ctx.fileCount)} shown):`, ctx.structure)
    }

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
    T extends {
      title: string
      description: string
      fileScope: string[]
      dependencies: number[]
      constraints?: string[]
      kind?: SubtaskKind
    },
  >(subtasks: T[]): Subtask[] {
    const n = subtasks.length
    const ids = Array.from({ length: n }, () => SubtaskID.ascending())

    return subtasks.map((st, i) => ({
      id: ids[i],
      title: st.title,
      description: st.description,
      fileScope: st.fileScope,
      dependencies: st.dependencies.map((depIdx) => ids[depIdx]),
      constraints: st.constraints,
      kind: st.kind,
    }))
  }

  /**
   * Check if two file scopes overlap.
   * Scopes overlap if they are equal, or one is a parent of the other.
   */
  function scopesOverlap(a: string, b: string): boolean {
    return a === b || a.startsWith(b + "/") || b.startsWith(a + "/")
  }

  /**
   * Predict potential merge conflicts by analyzing file scope overlaps.
   * Returns pairs of subtasks that have overlapping file scopes.
   */
  export function predictConflicts(subtasks: Subtask[]): Array<{
    subtaskA: SubtaskID
    subtaskB: SubtaskID
    overlappingFiles: string[]
  }> {
    const conflicts: Array<{ subtaskA: SubtaskID; subtaskB: SubtaskID; overlappingFiles: string[] }> = []

    for (let i = 0; i < subtasks.length; i++) {
      for (let j = i + 1; j < subtasks.length; j++) {
        const subtaskA = subtasks[i]
        const subtaskB = subtasks[j]

        // Find overlapping scopes between the two subtasks
        const overlappingFiles: string[] = []

        for (const scopeA of subtaskA.fileScope) {
          for (const scopeB of subtaskB.fileScope) {
            if (scopesOverlap(scopeA, scopeB)) {
              overlappingFiles.push(scopeA, scopeB)
            }
          }
        }

        if (overlappingFiles.length > 0) {
          conflicts.push({
            subtaskA: subtaskA.id,
            subtaskB: subtaskB.id,
            overlappingFiles: [...new Set(overlappingFiles)],
          })
        }
      }
    }

    return conflicts
  }

  export interface DecomposeResult {
    subtasks: Subtask[]
    sharedContracts?: SharedContract[]
    conventions?: ProjectConventions
  }

  const MAX_DECOMPOSE_RETRIES = 1

  async function decomposeOnce(input: {
    task: string
    model: ModelRef
    codebaseContext?: string
    profile: Profile
    overlapFeedback?: string
    feedback?: string
    planID?: PlanID
  }) {
    const fullModel = await Provider.getModel(input.model.providerID, input.model.modelID)
    const language = await Provider.getLanguage(fullModel)
    const mode = input.profile

    let userContent = input.codebaseContext
      ? `## Task\n${input.task}\n\n## Task Profile\n- Kind: ${mode.kind}\n- Reason: ${mode.reason}\n\n## Codebase Context\n${input.codebaseContext}`
      : `## Task\n${input.task}\n\n## Task Profile\n- Kind: ${mode.kind}\n- Reason: ${mode.reason}`

    if (input.overlapFeedback) {
      userContent += `\n\n## FILE SCOPE OVERLAP FEEDBACK (from previous attempt)\nYour previous decomposition had overlapping file scopes which will cause merge conflicts. Fix these overlaps by adjusting the fileScope arrays so each subtask touches a disjoint set of files:\n${input.overlapFeedback}`
    }

    if (input.feedback) {
      userContent += `\n\n## EXECUTION FEEDBACK (from previous failed attempt)\nThe previous execution of this plan failed. Learn from these failures and adjust your decomposition:\n${input.feedback}`
    }

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

    if (input.planID) {
      Metrics.recordTokenUsage({
        planID: input.planID,
        role: "orchestrator",
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      })
      const cost = Metrics.getPlanCost(input.planID)
      if (cost) {
        Bus.publish(ParallelEvent.PlanCostUpdate, {
          planID: input.planID,
          totalInputTokens: cost.totalInputTokens,
          totalOutputTokens: cost.totalOutputTokens,
          workerCount: cost.workerCount,
        })
      }
    }

    const depError = validateDependencies(result.object.subtasks)
    if (depError) {
      log.error("dependency validation failed", depError)
      throw new Error(`Invalid dependencies: ${depError.type} - ${depError.details}`)
    }

    return result.object
  }

  export async function decompose(input: {
    task: string
    model: ModelRef
    codebaseContext?: string
    profile?: Profile
    feedback?: string
    planID?: PlanID
  }): Promise<DecomposeResult> {
    log.info("decomposing task", { task: input.task.slice(0, 100) })

    const mode = input.profile ?? profile(input.task)

    let raw = await decomposeOnce({
      task: input.task,
      model: input.model,
      codebaseContext: input.codebaseContext,
      profile: mode,
      feedback: input.feedback,
      planID: input.planID,
    })

    // Retry loop: if overlaps are detected, re-prompt with feedback
    for (let attempt = 0; attempt < MAX_DECOMPOSE_RETRIES; attempt++) {
      const tempSubtasks = assignSubtaskIDs(
        raw.subtasks.map((subtask) => ({
          ...subtask,
          kind: subtask.kind ?? mode.kind,
        })),
      )
      const conflicts = predictConflicts(tempSubtasks)
      if (conflicts.length === 0) break

      const feedback = conflicts
        .map((c) => {
          const nameA = tempSubtasks.find((s) => s.id === c.subtaskA)?.title ?? String(c.subtaskA)
          const nameB = tempSubtasks.find((s) => s.id === c.subtaskB)?.title ?? String(c.subtaskB)
          return `- "${nameA}" and "${nameB}" overlap on: ${c.overlappingFiles.join(", ")}`
        })
        .join("\n")

      log.info("re-decomposing to fix overlaps", { attempt: attempt + 1, conflictCount: conflicts.length })

      raw = await decomposeOnce({
        task: input.task,
        model: input.model,
        codebaseContext: input.codebaseContext,
        profile: mode,
        overlapFeedback: feedback,
        planID: input.planID,
      })
    }

    let subtasks = assignSubtaskIDs(
      raw.subtasks.map((subtask) => ({
        ...subtask,
        kind: subtask.kind ?? mode.kind,
      })),
    )
    const ids = subtasks.map((s) => s.id)

    const refs = (idxs: number[], name: string, role: "producer" | "consumer"): Subtask["dependencies"] =>
      idxs.map((idx) => {
        if (idx >= ids.length) {
          throw new Error(`Invalid shared contract ${role} index ${idx} for "${name}" (valid: 0-${ids.length - 1})`)
        }
        return ids[idx]
      })

    const structural = mode.kind === "structural" && mode.simple
    subtasks = simplify(subtasks, input.task, mode)

    const sharedContracts = structural
      ? undefined
      : raw.sharedContracts?.map((sc) => ({
          name: sc.name,
          description: sc.description,
          types: sc.types,
          producers: refs(sc.producerIndices, sc.name, "producer"),
          consumers: refs(sc.consumerIndices, sc.name, "consumer"),
        }))

    const conventions = structural ? undefined : raw.conventions

    const conflicts = predictConflicts(subtasks)
    if (conflicts.length > 0) {
      log.warn("potential merge conflicts detected after retries", {
        conflictCount: conflicts.length,
        conflicts: conflicts.map((c) => ({
          subtaskA: subtasks.find((s) => s.id === c.subtaskA)?.title ?? c.subtaskA,
          subtaskB: subtasks.find((s) => s.id === c.subtaskB)?.title ?? c.subtaskB,
          overlappingFiles: c.overlappingFiles,
        })),
      })
    }

    log.info("decomposition complete", {
      count: subtasks.length,
      conflicts: conflicts.length,
      contracts: sharedContracts?.length ?? 0,
      hasConventions: !!conventions,
    })
    return { subtasks, sharedContracts, conventions }
  }
}
