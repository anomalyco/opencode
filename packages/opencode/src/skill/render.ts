import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import type { Interface as RipgrepInterface } from "../file/ripgrep"
import type { Info } from "./index"

export const render = Effect.fn("Skill.render")(function* (
  info: Info,
  rg: RipgrepInterface,
  signal?: AbortSignal,
) {
  const dir = path.dirname(info.location)
  const base = pathToFileURL(dir).href
  const hasDirectory = path.isAbsolute(info.location)
  const limit = 10
  const files = hasDirectory
    ? yield* rg.files({ cwd: dir, follow: false, hidden: true, signal }).pipe(
        Stream.filter((file) => !file.includes("SKILL.md")),
        Stream.map((file) => path.resolve(dir, file)),
        Stream.take(limit),
        Stream.runCollect,
        Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
      )
    : ""

  return {
    dir,
    output: [
      `<skill_content name="${info.name}">`,
      `# Skill: ${info.name}`,
      "",
      info.content.trim(),
      ...(hasDirectory
        ? [
            "",
            `Base directory for this skill: ${base}`,
            "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
            "Note: file list is sampled.",
            "",
            "<skill_files>",
            files,
            "</skill_files>",
          ]
        : []),
      "</skill_content>",
    ].join("\n"),
  }
})

export const SkillRender = { render }
