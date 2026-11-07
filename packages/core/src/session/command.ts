export * as SessionCommand from "./command.js"

import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { Effect } from "effect"
import { Bus } from "../bus.js"
import { Command } from "../command.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { SessionRevert } from "./revert.js"

export const execute = Effect.fn("SessionCommand.execute")(function* (input: {
  session: Session.Info
  command: string
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  delivery?: SessionInbox.Delivery
}) {
  const instances = yield* Instance.Service
  yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    // Commit a staged revert before the command runs, like Session.prompt does. A command can
    // queue work (such as a goal kickoff) that stays held behind the staged revert, and
    // committing afterwards would delete that queued work instead.
    if (input.session.revert) {
      const bus = yield* Bus.Service
      yield* SessionRevert.commit(bus, input.session)
    }
    const commands = yield* Command.Service
    yield* commands.execute({
      name: input.command,
      invocation: {
        sessionID: input.session.id,
        prompt: {
          text: input.text,
          files: input.files,
          agents: input.agents,
          skills: input.skills,
        },
        delivery: input.delivery ?? "steer",
      },
    })
  }).pipe(instances.provide(input.session))
})
