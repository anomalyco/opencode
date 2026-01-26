import path from "path"
import { minimatch } from "minimatch"
import z from "zod"
import { Instance } from "../project/instance"
import { ConfigMarkdown } from "../config/markdown"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

export namespace SmartRule {
  const log = Log.create({ service: "smart-rule" })

  // ────────────────────────────────────────────────────────────────
  // Types
  // ────────────────────────────────────────────────────────────────

  export const Frontmatter = z.object({
    description: z.string().optional(),
    paths: z.array(z.string()).optional(), // Primary
    globs: z.array(z.string()).optional(), // Alias
    patterns: z.array(z.string()).optional(), // Alias
    alwaysApply: z.boolean().optional(),
  })
  export type Frontmatter = z.infer<typeof Frontmatter>

  export interface Info {
    name: string
    path: string
    source: "opencode-project" | "claude-project" | "global"
    patterns: string[]
    matchers: ((file: string) => boolean)[] // Pre-compiled
    alwaysApply: boolean
    content: string
    description?: string
  }

  // ────────────────────────────────────────────────────────────────
  // State (per-project, cached via Instance.state)
  // ────────────────────────────────────────────────────────────────

  export const state = Instance.state(() => ({
    // Discovery cache - loaded once per project
    rules: null as Info[] | null,
    // Per-session tracked files
    files: {} as Record<string, Set<string>>,
  }))

  // ────────────────────────────────────────────────────────────────
  // File Tracking (called from FileTime.read)
  // ────────────────────────────────────────────────────────────────

  export function track(sessionID: string, filepath: string) {
    if (!Flag.OPENCODE_EXPERIMENTAL_SMART_RULES) return

    const s = state()
    s.files[sessionID] = s.files[sessionID] ?? new Set()

    // Normalize to relative path from worktree
    const relative = path.isAbsolute(filepath) ? path.relative(Instance.worktree, filepath) : filepath

    // Skip paths outside project
    if (relative.startsWith("..")) return

    s.files[sessionID].add(relative)
  }

  export function clearSession(sessionID: string) {
    const s = state()
    delete s.files[sessionID]
  }

  // ────────────────────────────────────────────────────────────────
  // Discovery (lazy-loaded, cached)
  // ────────────────────────────────────────────────────────────────

  const RULES_GLOB = new Bun.Glob("**/*.md")

  async function discover(): Promise<Info[]> {
    const s = state()
    if (s.rules !== null) return s.rules

    const rules = new Map<string, Info>()

    // 1. Global: ~/.config/opencode/rules/
    await scanDir(path.join(Global.Path.config, "rules"), "global", rules)

    // 2. Claude project: .claude/rules/ (compatibility)
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
      for await (const dir of Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanDir(path.join(dir, "rules"), "claude-project", rules)
      }
      // Global ~/.claude/rules/
      await scanDir(path.join(Global.Path.home, ".claude", "rules"), "claude-project", rules)
    }

    // 3. OpenCode project: .opencode/rules/ (highest precedence)
    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for await (const dir of Filesystem.up({
        targets: [".opencode"],
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanDir(path.join(dir, "rules"), "opencode-project", rules)
      }
    }

    s.rules = Array.from(rules.values())
    log.info("discovered rules", { count: s.rules.length })
    return s.rules
  }

  async function scanDir(dir: string, source: Info["source"], rules: Map<string, Info>) {
    if (!(await Filesystem.isDir(dir))) return

    for await (const match of RULES_GLOB.scan({
      cwd: dir,
      absolute: true,
      onlyFiles: true,
      followSymlinks: true,
      dot: true,
    })) {
      try {
        const rule = await parseRule(match, source)
        if (!rule) continue

        const key = rule.name.toLowerCase()
        const existing = rules.get(key)

        // Later sources override (opencode > claude > global)
        const priority = { global: 0, "claude-project": 1, "opencode-project": 2 }
        if (!existing || priority[source] > priority[existing.source]) {
          rules.set(key, rule)
        }
      } catch (err) {
        log.warn("failed to parse rule", { path: match, err })
      }
    }
  }

  async function parseRule(filepath: string, source: Info["source"]): Promise<Info | null> {
    const md = await ConfigMarkdown.parse(filepath)
    const parsed = Frontmatter.safeParse(md.data)
    if (!parsed.success) return null

    const fm = parsed.data
    const patterns = [...(fm.paths ?? []), ...(fm.globs ?? []), ...(fm.patterns ?? [])]

    // Pre-compile matchers for performance
    const matchers = patterns.map((p) => {
      return (file: string) => minimatch(file, p, { dot: true, matchBase: true })
    })

    return {
      name: path.basename(filepath, ".md"),
      path: filepath,
      source,
      patterns,
      matchers,
      alwaysApply: fm.alwaysApply ?? false,
      content: md.content.trim(),
      description: fm.description,
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Matching & Injection
  // ────────────────────────────────────────────────────────────────

  export async function inject(sessionID: string): Promise<string[]> {
    // Early exit checks
    if (!Flag.OPENCODE_EXPERIMENTAL_SMART_RULES) return []

    const s = state()
    const files = s.files[sessionID]
    if (!files || files.size === 0) return []

    const rules = await discover()
    if (rules.length === 0) return []

    const fileArray = Array.from(files)
    const matched: Info[] = []

    for (const rule of rules) {
      if (rule.alwaysApply) {
        matched.push(rule)
        continue
      }
      if (rule.matchers.length === 0) continue

      // Check if any file matches any pattern
      const matches = fileArray.some((file) => rule.matchers.some((matcher) => matcher(file)))
      if (matches) matched.push(rule)
    }

    if (matched.length === 0) return []

    // Build output
    const lines = [
      "<context-rules>",
      "The following rules apply based on the files you're working with:",
      "",
    ]

    for (const rule of matched) {
      lines.push(`### ${rule.name}`)
      if (rule.description) lines.push(`_${rule.description}_`)
      lines.push("", rule.content, "")
    }

    lines.push("</context-rules>")

    log.info("injected rules", {
      sessionID,
      count: matched.length,
      rules: matched.map((r) => r.name),
    })

    return [lines.join("\n")]
  }
}
