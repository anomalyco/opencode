export * as CommandPlugin from "./command"

import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

export const Plugin = define({
  id: "command",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((draft) => {
      draft.update("init", (command) => {
        command.template = PROMPT_INITIALIZE.replace("${path}", ctx.location.project.directory)
        command.description = "guided AGENTS.md setup"
      })
      draft.update("review", (command) => {
        command.template = PROMPT_REVIEW.replace("${path}", ctx.location.project.directory)
        command.description = "review changes [commit|branch|pr], defaults to uncommitted"
        command.subtask = true
      })
    })
  }),
})
