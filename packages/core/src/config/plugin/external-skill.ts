export * as ConfigExternalSkillPlugin from "./external-skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect } from "effect"
import { Flag } from "../../flag/flag"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { Location } from "../../location"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"

const CLAUDE_DIR = ".claude"
const AGENTS_DIR = ".agents"

export const Plugin = define({
  id: "config-external-skill",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const disableExternalSkills = Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS
    const disableClaudeCodeSkills = Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS

    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        if (disableExternalSkills) return

        const externalDirs: string[] = []
        if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_DIR)
        externalDirs.push(AGENTS_DIR)

        for (const dir of externalDirs) {
          const root = path.join(global.home, dir, "skills")
          if (!(yield* fs.isDir(root))) continue
          draft.source(SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make(root) }))
        }

        const upDirs = yield* fs
          .up({ targets: externalDirs, start: location.directory, stop: location.project.directory })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))

        for (const root of upDirs) {
          const skillsRoot = path.join(root, "skills")
          if (!(yield* fs.isDir(skillsRoot))) continue
          draft.source(SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make(skillsRoot) }))
        }
      }),
    )
  }),
})
