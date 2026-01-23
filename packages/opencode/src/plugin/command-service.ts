import type { PluginCommandInput } from "@opencode-ai/plugin"
import { Command } from "../command"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { PluginCommand } from "./command"
import type { SessionPrompt } from "../session/prompt"
import { NamedError } from "@opencode-ai/util/error"

export namespace PluginCommandService {
  export async function execute(input: {
    command: Command.Entry
    request: SessionPrompt.CommandInput
    agent: string
    model: { providerID: string; modelID: string }
    userMessage: MessageV2.WithParts
  }): Promise<MessageV2.WithParts> {
    const execution = await PluginCommand.execute(input.command.name, {
      sessionID: input.request.sessionID,
      command: input.request.command,
      arguments: input.request.arguments,
      messageID: input.userMessage.info.id,
      agent: input.agent,
      model: input.request.model ?? input.command.model ?? `${input.model.providerID}/${input.model.modelID}`,
      variant: input.request.variant,
      parts: input.userMessage.parts as PluginCommandInput["parts"],
    })
      .then((result) => ({ result }))
      .catch((error) => ({ error }))

    const errorResult = async (error: MessageV2.Assistant["error"], message: string) => {
      const now = Date.now()
      const info: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
        sessionID: input.request.sessionID,
        parentID: input.userMessage.info.id,
        role: "assistant",
        mode: input.agent,
        agent: input.agent,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: input.model.modelID,
        providerID: input.model.providerID,
        time: {
          created: now,
          completed: now,
        },
        error,
      }
      const part: MessageV2.TextPart = {
        id: Identifier.ascending("part"),
        messageID: info.id,
        sessionID: info.sessionID,
        type: "text",
        text: message,
      }
      await Session.updateMessage(info)
      await Session.updatePart(part)
      Bus.publish(Session.Event.Error, {
        sessionID: input.request.sessionID,
        error,
      })
      return { info, parts: [part] }
    }

    if ("error" in execution) {
      const error = MessageV2.fromError(execution.error, { providerID: input.model.providerID })
      const message = execution.error instanceof Error ? execution.error.message : "Plugin command failed"
      return await errorResult(error, message)
    }

    if (!execution.result) {
      const error = new NamedError.Unknown({ message: "Plugin command not handled." }).toObject()
      return await errorResult(error, "Plugin command not handled.")
    }

    const now = Date.now()
    const info: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.request.sessionID,
      parentID: input.userMessage.info.id,
      role: "assistant",
      mode: input.agent,
      agent: input.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: input.model.modelID,
      providerID: input.model.providerID,
      time: {
        created: now,
        completed: now,
      },
    }
    const outputParts = execution.result.parts.map((part) => ({
      ...part,
      id: part.id ?? Identifier.ascending("part"),
      messageID: info.id,
      sessionID: info.sessionID,
    }))
    await Session.updateMessage(info)
    for (const part of outputParts) {
      await Session.updatePart(part)
    }

    Bus.publish(Command.Event.Executed, {
      name: input.request.command,
      sessionID: input.request.sessionID,
      arguments: input.request.arguments,
      messageID: info.id,
    })

    return {
      info,
      parts: outputParts,
    }
  }
}
