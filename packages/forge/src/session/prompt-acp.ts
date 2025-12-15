import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { Session } from "."
import { fn } from "@/util/fn"
import { ACPOrchestrator } from "../acp/orchestrator"
import { DEFAULT_AGENT } from "../acp/agents"

export namespace SessionPromptACP {
  const log = Log.create({ service: "session.prompt.acp" })

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  /**
   * Send a prompt to the ACP agent and return the assistant's response.
   *
   * This replaces the AI SDK-based prompt handler with ACP client integration.
   */
  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    const existingState = ACPOrchestrator.getState(input.sessionID)

    // Ensure agent is selected - throw error if not
    if (!existingState || !existingState.agent) {
      throw new Error("No agent selected. Please select an agent before sending a prompt.")
    }

    const state = existingState
    await Session.touch(input.sessionID)

    // Create user message
    const userMessageID = input.messageID ?? Identifier.ascending("message")
    const userMessage: MessageV2.User = {
      id: userMessageID,
      sessionID: input.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: state.agent!.name,
      model: {
        providerID: "acp",
        modelID: state.models?.currentModelId ?? "default",
      },
    }

    await Session.updateMessage(userMessage)

    // Save user message parts
    for (const partInput of input.parts) {
      const part: MessageV2.Part = {
        ...partInput,
        id: partInput.id ?? Identifier.ascending("part"),
        messageID: userMessageID,
        sessionID: input.sessionID,
      } as MessageV2.Part

      await Session.updatePart(part)
    }

    log.info("sending prompt to ACP", {
      sessionID: input.sessionID,
      userMessageID,
      parts: input.parts.length,
    })

    // Send prompt via ACP orchestrator
    const assistantMessage = await ACPOrchestrator.sendPrompt({
      sessionID: input.sessionID,
      parts: input.parts.map((p) => {
        if (p.type === "text") {
          return { type: "text" as const, text: p.text }
        }
        return {
          type: "file" as const,
          url: p.url,
          filename: p.filename ?? "file",
          mime: p.mime,
        }
      }),
    })

    log.info("received response from ACP", {
      sessionID: input.sessionID,
      assistantMessageID: assistantMessage.info.id,
    })

    return assistantMessage
  })
}
