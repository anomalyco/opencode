export * as SessionCommand from "./command.js"

import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { Effect } from "effect"
import { Command } from "../command.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"

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
  const commands = yield* Plugin.awaitActivation.pipe(Effect.andThen(Command.Service), instances.provide(input.session))
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
})
