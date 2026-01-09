import path from "path"
import { ConfigMarkdown } from "./markdown"
import { Config } from "./config"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { existsSync } from "fs"
import { SystemPrompt } from "@/session/system"

export interface Rule {
  filePath: string
  paths?: string[]
  content: string
}

export namespace Rules {
  async function parse(filePath: string): Promise<Rule> {
    const md = await ConfigMarkdown.parse(filePath)
    const frontmatter = md.data as Record<string, unknown> | undefined

    const paths = frontmatter?.paths
    let pathsArray: string[] | undefined

    if (paths !== undefined) {
      if (typeof paths === "string") {
        pathsArray = [paths]
      } else if (Array.isArray(paths)) {
        pathsArray = paths.filter((p) => typeof p === "string") as string[]
      }
    }

    return {
      filePath,
      paths: pathsArray,
      content: md.content.trim(),
    }
  }

  function sortPatternsBySpecificity(patterns: string[]): string[] {
    const positives: string[] = []
    const negatives: string[] = []

    for (const pattern of patterns) {
      if (pattern.startsWith("!")) {
        negatives.push(pattern)
      } else {
        positives.push(pattern)
      }
    }

    positives.sort((a, b) => {
      const aDepth = a.split("/").length
      const bDepth = b.split("/").length
      if (aDepth !== bDepth) return aDepth - bDepth

      const aWildcards = (a.match(/\*\*/g) || []).length + (a.match(/\*/g) || []).length
      const bWildcards = (b.match(/\*\*/g) || []).length + (b.match(/\*/g) || []).length
      if (aWildcards !== bWildcards) return bWildcards - aWildcards

      return a.localeCompare(b)
    })

    return [...positives, ...negatives]
  }

  function matchesPattern(filepath: string, pattern: string): boolean {
    return new Bun.Glob(pattern).match(filepath)
  }

  export function matchRulesForFile(rules: Rule[], filepath: string): string[] {
    const matchedContents: string[] = []
    const seenContents = new Set<string>()

    const relative = path.isAbsolute(filepath) ? path.relative(Instance.worktree, filepath) : filepath

    const rulesWithPaths = rules.filter((r) => r.paths && r.paths.length > 0)
    const globalRules = rules.filter((r) => !r.paths || r.paths.length === 0)

    for (const rule of globalRules) {
      if (!seenContents.has(rule.content)) {
        seenContents.add(rule.content)
        matchedContents.push(rule.content)
      }
    }

    for (const rule of rulesWithPaths) {
      const patterns = sortPatternsBySpecificity(rule.paths ?? [])

      let matched = false
      let excluded = false

      for (const pattern of patterns) {
        if (pattern.startsWith("!")) {
          if (matchesPattern(relative, pattern.slice(1))) {
            excluded = true
            break
          }
        } else {
          if (matchesPattern(relative, pattern)) {
            matched = true
          }
        }
      }

      if (matched && !excluded) {
        if (!seenContents.has(rule.content)) {
          seenContents.add(rule.content)
          matchedContents.push(rule.content)
        }
      }
    }

    return matchedContents
  }

  export async function loadForFile(filepath: string): Promise<Rule[]> {
    const config = await Config.get()
    const rulesConfig = config.subdirectoryRules

    if (!rulesConfig?.enabled) return []

    const patterns = rulesConfig?.patterns ?? ["**/AGENTS.md"]
    const exact = rulesConfig?.exact ?? false
    const directories = await Array.fromAsync(
      Filesystem.up({
        targets: ["."],
        start: path.dirname(filepath),
        stop: Instance.worktree,
      }),
    ).then((dirs) => {
      // Exclude root directory as it's already in the system prompt
      const filtered = dirs.filter((dir) => dir !== Instance.worktree)
      return exact ? (filtered.length > 0 ? [filtered[0]] : []) : filtered.reverse()
    })

    const results: Rule[] = []
    const seen = new Set<string>()
    const worktree = Instance.worktree
    const rootExclusions = new Set(SystemPrompt.LOCAL_RULE_FILES.map((f) => path.join(worktree, f)))

    for (const dir of directories) {
      if (!dir || !existsSync(dir)) continue
      // Ensure we don't leak outside the worktree if it's set to root
      if (worktree === "/" && !dir.startsWith(Instance.directory)) continue
      for (const pattern of patterns) {
        const glob = new Bun.Glob(pattern)
        for await (const file of glob.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
        })) {
          if (rootExclusions.has(file) || seen.has(file)) continue
          seen.add(file)
          results.push(await parse(file))
        }
      }
    }
    return results
  }
}
