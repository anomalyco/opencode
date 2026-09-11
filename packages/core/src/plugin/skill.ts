/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeArgusContent from "./skill/customize-argus.md" with { type: "text" }

export const CustomizeArgusContent = customizeArgusContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-argus",
            description:
              "Use ONLY when the user is editing or creating argus's own configuration: argus.json, argus.jsonc, files under .argus/, or files under ~/.config/argus/. Also use when creating or fixing argus agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring argus itself.",
            location: AbsolutePath.make("/builtin/customize-argus.md"),
            content: CustomizeArgusContent,
          }),
        }),
      )
    })
  }),
})
