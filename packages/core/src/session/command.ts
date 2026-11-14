export * as SessionCommand from "./command.js"

import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { Command } from "../command.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"

export const execute = Effect.fn("SessionCommand.execute")(function* (input: {
  session: Session.Info
  id?: SessionMessage.ID
  command: string
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  delivery?: SessionInbox.Delivery
  unattended?: boolean
  inline?: boolean
  note?: string
}) {
  const instances = yield* Instance.Service
  yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const commands = yield* Command.Service
    yield* commands.execute({
      name: input.command,
      invocation: {
        sessionID: input.session.id,
        messageID: input.id,
        prompt: {
          text: input.text,
          files: input.files,
          agents: input.agents,
          skills: input.skills,
        },
        delivery: input.delivery ?? "steer",
        unattended: input.unattended,
        inline: input.inline,
        note: input.note,
      },
    })
  }).pipe(instances.provide(input.session))
})
