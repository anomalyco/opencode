/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizePencodeContent from "./skill/customize-pencode.md" with { type: "text" }

export const CustomizePencodeContent = customizePencodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-pencode",
            description:
              "Use ONLY when the user is editing or creating pencode's own configuration: pencode.json, pencode.jsonc, files under .pencode/, or files under ~/.config/pencode/. Also use when creating or fixing pencode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring pencode itself.",
            location: AbsolutePath.make("/builtin/customize-pencode.md"),
            content: CustomizePencodeContent,
          }),
        }),
      )
    })
  }),
})
