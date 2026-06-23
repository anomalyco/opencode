/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-opencode.md" with { type: "text" }
import workflowsInstructionsContent from "./skill/workflows-instructions.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent
export const WorkflowsInstructionsContent = workflowsInstructionsContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-opencode",
            description:
              "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
            location: AbsolutePath.make("/builtin/customize-opencode.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
      draft.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "workflows-instructions",
            description:
              "Use when the user asks to create, modify, run, debug, or review opencode workflows. Explains workflow authoring, the native workflow tool, foreground/background execution, permissions, and how to inspect logs, agents, and results. Do not use for ordinary tasks unless the user explicitly wants workflow automation.",
            location: AbsolutePath.make("/builtin/workflows-instructions.md"),
            content: WorkflowsInstructionsContent,
          }),
        }),
      )
    })
  }),
})
