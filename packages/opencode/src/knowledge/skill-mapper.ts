import { Skill } from "../skill"
import { Log } from "../util/log"

const log = Log.create({ service: "knowledge.skill-mapper" })

export namespace SkillMapper {
  // Map tags to relevant skills
  const TAG_TO_SKILLS: Record<string, string[]> = {
    // Recovery & debugging
    recovery: ["systematic-debugging"],
    retry: ["systematic-debugging"],
    fallback: ["systematic-debugging"],
    workaround: ["systematic-debugging"],

    // Architecture & design
    architecture: ["opencode-dev-ops", "writing-plans"],
    "design-pattern": ["opencode-dev-ops"],
    refactor: ["opencode-dev-ops"],
    modular: ["opencode-dev-ops"],

    // Testing & quality
    testing: ["test-driven-development"],
    coverage: ["test-driven-development"],
    "unit-test": ["test-driven-development"],
    "integration-test": ["test-driven-development"],

    // Performance
    performance: ["requesting-code-review"],
    optimization: ["requesting-code-review"],

    // Security
    security: ["requesting-code-review"],
    auth: ["opencode-dev-ops"],

    // Deployment
    deployment: ["finishing-a-development-branch"],
    release: ["finishing-a-development-branch"],
    "breaking-change": ["requesting-code-review"],

    // Documentation
    documentation: ["writing-skills"],
    process: ["brainstorming"],
  }

  export async function getSkillsForTags(tags: string[]): Promise<Skill.Info[]> {
    const skillNames = new Set<string>()

    for (const tag of tags) {
      const skills = TAG_TO_SKILLS[tag.toLowerCase()] || []
      skills.forEach((s) => skillNames.add(s))
    }

    const result: Skill.Info[] = []

    for (const name of skillNames) {
      try {
        const skill = await Skill.get(name)
        if (skill) {
          result.push(skill)
        }
      } catch (err) {
        log.warn("skill not found", { name })
      }
    }

    return result
  }

  export function formatSkillsForPrompt(skills: Skill.Info[]): string {
    if (skills.length === 0) return ""

    const lines: string[] = [
      "## Auto-Injected Skills",
      "",
      "Based on the knowledge search results, these skills may be relevant to your task:",
      "",
    ]

    for (const skill of skills) {
      lines.push(`### ${skill.name}`)
      lines.push("")
      lines.push(skill.content.split("\n").slice(0, 5).join("\n"))
      lines.push("")
      lines.push("[Full skill available via skill tool]")
      lines.push("")
    }

    return lines.join("\n")
  }
}
