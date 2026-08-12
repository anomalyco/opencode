/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeMoksContent from "./skill/customize-moks.md" with { type: "text" }

export const CustomizeMoksContent = customizeMoksContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-moks",
            description:
              "Use ONLY when the user is editing or creating moks configuration: moks.json, opencode.json dual-load paths, files under .moks/, .opencode/, or global moks/opencode config. Also use when creating or fixing recruit/plan agents, hiring skills, decision verbs (commit/status/push), Ashby MCP edge, permissions, plugins, or MCP servers. Do not use for the user's own application code, or for any project that is not configuring moks.",
            location: AbsolutePath.make("/builtin/customize-moks.md"),
            content: CustomizeMoksContent,
          }),
        }),
      )
    })
  }),
})
