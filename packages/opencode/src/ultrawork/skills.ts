/**
 * ULTRAWORK Skills - Auto-Skill Builder
 *
 * Automatically creates and manages reusable skills (capabilities)
 * that the orchestrator can learn and deploy on demand.
 *
 * When the system encounters a task it doesn't know how to do,
 * it creates a new skill, saves it, and uses it for future tasks.
 *
 * Inspired by:
 * - ClawdBot's auto-skills (565+ community skills)
 * - AntiGravity's skill builder pattern
 * - EvoAgentX's self-evolving capabilities
 * - Claude Code's agent skills system
 *
 * Skills are stored as markdown files with YAML frontmatter,
 * compatible with OpenCode's existing skill system.
 */

import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"

export namespace UltraworkSkills {
  const log = Log.create({ service: "ultrawork.skills" })

  const SKILLS_DIR = path.join(Global.Path.data, "ultrawork", "skills")

  /**
   * Skill definition
   */
  export interface Skill {
    name: string
    description: string
    tags: string[]
    version: string
    author: string
    createdAt: number
    updatedAt: number
    usageCount: number
    successRate: number
    template: string
    dependencies: string[]
    parameters: SkillParameter[]
  }

  export interface SkillParameter {
    name: string
    type: "string" | "number" | "boolean" | "array"
    description: string
    required: boolean
    default?: any
  }

  /**
   * Skill registry (in-memory cache)
   */
  let skillCache: Map<string, Skill> | null = null

  /**
   * Load all skills from disk
   */
  async function loadSkills(): Promise<Map<string, Skill>> {
    if (skillCache) return skillCache

    skillCache = new Map()

    try {
      await fs.mkdir(SKILLS_DIR, { recursive: true })
      const files = await fs.readdir(SKILLS_DIR)

      for (const file of files) {
        if (!file.endsWith(".json")) continue
        try {
          const content = await fs.readFile(path.join(SKILLS_DIR, file), "utf-8")
          const skill: Skill = JSON.parse(content)
          skillCache.set(skill.name, skill)
        } catch (e: any) {
          log.error("failed to load skill", { file, error: e.message })
        }
      }

      log.info("loaded skills", { count: skillCache.size })
    } catch (e: any) {
      log.error("failed to initialize skills directory", { error: e.message })
    }

    return skillCache
  }

  /**
   * Save a skill to disk
   */
  async function saveSkill(skill: Skill): Promise<void> {
    try {
      await fs.mkdir(SKILLS_DIR, { recursive: true })
      const filename = `${skill.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.json`
      await fs.writeFile(path.join(SKILLS_DIR, filename), JSON.stringify(skill, null, 2))
    } catch (e: any) {
      log.error("failed to save skill", { name: skill.name, error: e.message })
    }
  }

  /**
   * Create a new skill from a task pattern
   */
  export async function create(input: {
    name: string
    description: string
    template: string
    tags?: string[]
    parameters?: SkillParameter[]
    dependencies?: string[]
  }): Promise<Skill> {
    const skills = await loadSkills()

    const skill: Skill = {
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      version: "1.0.0",
      author: "ultrawork",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
      successRate: 1.0,
      template: input.template,
      dependencies: input.dependencies ?? [],
      parameters: input.parameters ?? [],
    }

    skills.set(skill.name, skill)
    await saveSkill(skill)

    log.info("skill created", { name: skill.name, tags: skill.tags })
    return skill
  }

  /**
   * Get a skill by name
   */
  export async function get(name: string): Promise<Skill | undefined> {
    const skills = await loadSkills()
    return skills.get(name)
  }

  /**
   * List all available skills
   */
  export async function list(): Promise<Skill[]> {
    const skills = await loadSkills()
    return Array.from(skills.values()).sort((a, b) => b.usageCount - a.usageCount)
  }

  /**
   * Find skills matching a query
   */
  export async function search(query: string): Promise<Skill[]> {
    const skills = await loadSkills()
    const lower = query.toLowerCase()

    return Array.from(skills.values()).filter(
      (skill) =>
        skill.name.toLowerCase().includes(lower) ||
        skill.description.toLowerCase().includes(lower) ||
        skill.tags.some((t) => t.toLowerCase().includes(lower)),
    )
  }

  /**
   * Record skill usage and update success rate
   */
  export async function recordUsage(name: string, success: boolean): Promise<void> {
    const skills = await loadSkills()
    const skill = skills.get(name)
    if (!skill) return

    const prevTotal = skill.usageCount
    const prevSuccesses = Math.round(skill.successRate * prevTotal)

    skill.usageCount++
    skill.successRate = (prevSuccesses + (success ? 1 : 0)) / skill.usageCount
    skill.updatedAt = Date.now()

    skills.set(name, skill)
    await saveSkill(skill)
  }

  /**
   * Generate a SKILL.md compatible file for a skill.
   * This makes ultrawork skills compatible with OpenCode's
   * existing skill system and Claude Code's agent skills.
   */
  export function toSkillMd(skill: Skill): string {
    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      skill.tags.length > 0 ? `tags: [${skill.tags.join(", ")}]` : "",
      `version: ${skill.version}`,
      `author: ${skill.author}`,
      "---",
    ]
      .filter(Boolean)
      .join("\n")

    const params =
      skill.parameters.length > 0
        ? [
            "",
            "## Parameters",
            "",
            ...skill.parameters.map(
              (p) =>
                `- **${p.name}** (${p.type}${p.required ? ", required" : ""}): ${p.description}${p.default !== undefined ? ` (default: ${p.default})` : ""}`,
            ),
          ].join("\n")
        : ""

    const deps =
      skill.dependencies.length > 0
        ? [
            "",
            "## Dependencies",
            "",
            ...skill.dependencies.map((d) => `- ${d}`),
          ].join("\n")
        : ""

    return `${frontmatter}\n\n${skill.template}${params}${deps}\n`
  }

  /**
   * Export a skill as an OpenCode-compatible SKILL.md file
   */
  export async function exportToSkillDir(name: string, targetDir: string): Promise<string | null> {
    const skill = await get(name)
    if (!skill) return null

    const skillDir = path.join(targetDir, ".opencode", "skill", skill.name)
    await fs.mkdir(skillDir, { recursive: true })

    const content = toSkillMd(skill)
    const filePath = path.join(skillDir, "SKILL.md")
    await fs.writeFile(filePath, content)

    log.info("skill exported", { name, path: filePath })
    return filePath
  }

  /**
   * Delete a skill
   */
  export async function remove(name: string): Promise<boolean> {
    const skills = await loadSkills()
    if (!skills.has(name)) return false

    skills.delete(name)
    const filename = `${name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.json`
    try {
      await fs.unlink(path.join(SKILLS_DIR, filename))
    } catch {
      // ignore
    }

    log.info("skill removed", { name })
    return true
  }

  // === Built-in starter skills ===

  /**
   * Install default starter skills that come with ULTRAWORK
   */
  export async function installDefaults(): Promise<void> {
    const defaults: Parameters<typeof create>[0][] = [
      {
        name: "web-scrape",
        description: "Scrape content from a web page and extract structured data",
        tags: ["web", "data", "scraping"],
        template: [
          "Use the webfetch tool to retrieve the content of the target URL.",
          "Parse the HTML/markdown content and extract the requested data fields.",
          "Return the results in a structured JSON format.",
        ].join("\n"),
        parameters: [
          { name: "url", type: "string", description: "URL to scrape", required: true },
          {
            name: "fields",
            type: "array",
            description: "Data fields to extract",
            required: true,
          },
        ],
      },
      {
        name: "git-pr-review",
        description: "Review a pull request and provide detailed feedback",
        tags: ["git", "code-review", "quality"],
        template: [
          "Fetch the PR diff and understand all changes made.",
          "Check for: code quality, security issues, test coverage, documentation.",
          "Provide structured feedback with severity levels: critical, warning, suggestion.",
          "Summarize overall assessment and recommendation (approve/request-changes).",
        ].join("\n"),
        parameters: [
          { name: "pr_number", type: "number", description: "PR number", required: true },
        ],
      },
      {
        name: "project-scaffold",
        description: "Create a new project from scratch based on requirements",
        tags: ["project", "scaffold", "bootstrap"],
        template: [
          "Analyze the project requirements and choose appropriate tech stack.",
          "Create project directory structure with all necessary config files.",
          "Set up package.json/pyproject.toml with dependencies.",
          "Create initial source files with boilerplate code.",
          "Add README.md with setup instructions.",
          "Initialize git repository with .gitignore.",
        ].join("\n"),
        parameters: [
          { name: "name", type: "string", description: "Project name", required: true },
          { name: "type", type: "string", description: "Project type (web, api, cli, lib)", required: true },
          { name: "language", type: "string", description: "Primary language", required: true, default: "typescript" },
        ],
      },
      {
        name: "debug-investigate",
        description: "Systematically investigate and diagnose a bug",
        tags: ["debug", "investigation", "troubleshooting"],
        template: [
          "1. Reproduce the issue by understanding the error description.",
          "2. Search codebase for related code using grep and glob.",
          "3. Read the relevant source files to understand the logic.",
          "4. Identify the root cause through logical analysis.",
          "5. Propose a fix with explanation of why it works.",
          "6. Check for similar patterns that might have the same bug.",
        ].join("\n"),
        parameters: [
          { name: "error", type: "string", description: "Error message or bug description", required: true },
        ],
      },
      {
        name: "multi-ai-consensus",
        description: "Get consensus from multiple AI sources on a technical decision",
        tags: ["consensus", "multi-ai", "decision"],
        template: [
          "Present the technical question to multiple AI federation members.",
          "Collect their independent analyses and recommendations.",
          "Compare responses and identify areas of agreement and disagreement.",
          "Synthesize a final recommendation with confidence level.",
          "Document dissenting opinions for consideration.",
        ].join("\n"),
        parameters: [
          { name: "question", type: "string", description: "Technical question to evaluate", required: true },
          { name: "ai_count", type: "number", description: "Number of AIs to consult", required: false, default: 3 },
        ],
      },
    ]

    for (const skill of defaults) {
      const existing = await get(skill.name)
      if (!existing) {
        await create(skill)
      }
    }

    log.info("default skills installed", { count: defaults.length })
  }
}
