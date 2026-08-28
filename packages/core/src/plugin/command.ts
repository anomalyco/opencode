export * as CommandPlugin from "./command"

import { define } from "./internal"
import { Effect } from "effect"
import { Location } from "../location"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

export const Plugin = define({
  id: "command",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    yield* ctx.command.transform((draft) => {
      draft.update("init", (command) => {
        command.template = PROMPT_INITIALIZE.replace("${path}", location.project.directory)
        command.description = "guided AGENTS.md setup"
      })
      draft.update("review", (command) => {
        command.template = PROMPT_REVIEW.replace("${path}", location.project.directory)
        command.description = "review changes [commit|branch|pr], defaults to uncommitted"
        command.subtask = true
      })
      draft.update("autodrive", (command) => {
        command.template =
          "Please execute the following task with Auto-Drive enabled. Continuously execute subsequent steps, code modifications, and test verifications until fully finished without stopping mid-way for confirmation.\n\nTask:\n$ARGUMENTS"
        command.description = "autonomous Auto-Drive continuous execution mode"
      })
      draft.update("auto-drive", (command) => {
        command.template =
          "Please execute the following task with Auto-Drive enabled. Continuously execute subsequent steps, code modifications, and test verifications until fully finished without stopping mid-way for confirmation.\n\nTask:\n$ARGUMENTS"
        command.description = "autonomous Auto-Drive continuous execution mode"
      })
    })
  }),
})
