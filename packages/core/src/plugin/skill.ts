/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-opencode.md" with { type: "text" }
import importOpencodeContent from "./skill/import-opencode.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent
export const ImportOpencodeContent = importOpencodeContent

export const CUSTOMIZE_OPENCODE_DESCRIPTION =
  "Use ONLY when the user is editing or creating KanCode configuration: kancode.json, kancode.jsonc, files under .kancode/, or files under the global KanCode config directory. Also use when creating or fixing KanCode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring KanCode itself."

export const IMPORT_OPENCODE_DESCRIPTION =
  "Use when the user wants to import or migrate content from a legacy .opencode/ directory into .kancode/. Supports choosing skills, commands, agents, themes, or plans. Do not use for ordinary application code."

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-opencode",
            description: CUSTOMIZE_OPENCODE_DESCRIPTION,
            location: AbsolutePath.make("/builtin/customize-opencode.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "import-opencode",
            description: IMPORT_OPENCODE_DESCRIPTION,
            location: AbsolutePath.make("/builtin/import-opencode.md"),
            content: ImportOpencodeContent,
          }),
        }),
      )
    })
  }),
})
