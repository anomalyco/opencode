import z from "zod"
import path from "path"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Session } from "@/session"
import { SkillRegistry } from "./registry"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
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

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      if (skills[parsed.data.name]) {
        log.info("skill override", {
          name: parsed.data.name,
          previous: skills[parsed.data.name].location,
          new: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
      }
    }

    // Priority 1 (lowest): Global ~/.claude/skills/
    const globalClaude = `${Global.Path.home}/.claude`
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS && (await Filesystem.isDir(globalClaude))) {
      const matches = await Array.fromAsync(
        CLAUDE_SKILL_GLOB.scan({
          cwd: globalClaude,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      ).catch((error) => {
        log.error("failed global .claude directory scan for skills", { dir: globalClaude, error })
        return []
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }

    // Priority 2: Skills from plugins
    for (const skillPath of SkillRegistry.paths()) {
      const skillFile = path.join(skillPath, "SKILL.md")
      await addSkill(skillFile)
    }

    // Priority 3: Project-level .claude/skills/ directories
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) {
      const projectClaudeDirs = await Array.fromAsync(
        Filesystem.up({
          targets: [".claude"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )
      for (const dir of projectClaudeDirs) {
        const matches = await Array.fromAsync(
          CLAUDE_SKILL_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          log.error("failed .claude directory scan for skills", { dir, error })
          return []
        })
        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    // Priority 4 (highest): Project-level .opencode/skill/ directories
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

    return skills
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }
}
