/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeApexContent from "./skill/customize-apex.md" with { type: "text" }

export const CustomizeApexContent = customizeApexContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-apex",
            description:
              "Use ONLY when the user is editing or creating apex's own configuration: apex.json, apex.jsonc, files under .apex/, or files under ~/.config/apex/. Also use when creating or fixing apex agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring apex itself.",
            location: AbsolutePath.make("/builtin/customize-apex.md"),
            content: CustomizeApexContent,
          }),
        }),
      )
      draft.source(
        new SkillV2.DirectorySource({
          type: "directory",
          path: AbsolutePath.make(
            path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../opencode/assets/skills"),
          ),
        }),
      )
    })
  }),
})
