import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { WellKnown } from "@/util/wellknown"
import { exists } from "fs/promises"

export namespace Skill {
  const log = Log.create({ service: "skill" })

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    remote: z.boolean().optional(),
    baseUrl: z.string().optional(),
    hostname: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  const OPENCODE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  /**
   * Load remote skills from all authenticated wellknown endpoints.
   * Returns skills keyed by their original name (not namespaced).
   * Namespacing only happens during merge if there's a local collision.
   * First authenticated endpoint wins for remote collisions.
   */
  async function loadRemoteSkills(): Promise<Record<string, Info>> {
    const config = await Config.get()
    if (config.experimental?.remote_skills === false) {
      return {}
    }

    const skills: Record<string, Info> = {}
    const endpoints = await WellKnown.getAuthenticatedEndpoints()

    for (const baseUrl of endpoints) {
      const index = await WellKnown.getIndex(baseUrl)
      if (!index?.skills) continue

      const hostname = WellKnown.getHostname(baseUrl)

      for (const [name, skill] of Object.entries(index.skills)) {
        // First endpoint wins for same skill name
        if (skills[name]) {
          log.warn("duplicate remote skill name", {
            name,
            existing: skills[name].location,
            duplicate: skill.url,
          })
          continue
        }

        skills[name] = {
          name,
          description: skill.description,
          location: skill.url,
          remote: true,
          baseUrl,
          // Store hostname for potential namespacing if there's a local collision
          hostname,
        }
      }
    }

    return skills
  }

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match)
      if (!md) {
        return
      }

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
      }
    }

    // Scan .claude/skills/ directories (project-level)
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    // Also include global ~/.claude/skills/
    const globalClaude = `${Global.Path.home}/.claude`
    if (await exists(globalClaude)) {
      claudeDirs.push(globalClaude)
    }

    for (const dir of claudeDirs) {
      for await (const match of CLAUDE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
        dot: true,
      })) {
        await addSkill(match)
      }
    }

    // Scan .opencode/skill/ directories
    for (const dir of await Config.directories()) {
      for await (const match of OPENCODE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Load remote skills from wellknown endpoints
    // Remote skills use plain names by default, but get namespaced (hostname:name)
    // if there's a collision with a local skill
    const remoteSkills = await loadRemoteSkills()
    for (const [name, skill] of Object.entries(remoteSkills)) {
      if (skills[name]) {
        // Local skill exists - namespace the remote skill
        const namespacedName = `${skill.hostname}:${name}`
        log.debug("namespacing remote skill due to local collision", { name, namespacedName })
        skills[namespacedName] = { ...skill, name: namespacedName }
      } else {
        skills[name] = skill
      }
    }

    return skills
  })

  /**
   * Get a skill by name.
   * For remote skills, fetches content lazily on first access.
   */
  export async function get(name: string): Promise<Info | undefined> {
    const skills = await state()
    return skills[name]
  }

  /**
   * Get skill content by name.
   * For local skills, reads from filesystem.
   * For remote skills, fetches from URL with caching.
   */
  export async function getContent(name: string): Promise<string | undefined> {
    const skill = await get(name)
    if (!skill) return undefined

    if (skill.remote && skill.baseUrl) {
      const content = await WellKnown.fetchContent(skill.location, skill.baseUrl)
      if (!content) {
        log.warn("failed to fetch remote skill content", { name, url: skill.location })
        return undefined
      }
      return content
    }

    // Local skill - read from filesystem
    const file = Bun.file(skill.location)
    return file.text().catch(() => undefined)
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }
}
