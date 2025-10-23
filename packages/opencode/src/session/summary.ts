import { Provider } from "@/provider/provider"
import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."
import { generateText } from "ai"
import { MessageV2 } from "./message-v2"
import { Flag } from "@/flag/flag"

export namespace MessageSummary {
  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      providerID: z.string(),
    }),
    async (input) => {
      if (!Flag.OPENCODE_EXPERIMENTAL_TURN_SUMMARY) return
      const messages = await Session.messages(input.sessionID).then((msgs) =>
        msgs.filter(
          (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
        ),
      )
      const small = await Provider.getSmallModel(input.providerID)
      if (!small) return

      const result = await generateText({
        model: small.language,
        maxOutputTokens: 100,
        messages: [
          {
            role: "user",
            content: `
            Summarize the following conversation into 2 sentences MAX explaining what the assistant did and why. Do not explain the user's input.
            <conversation>
            ${JSON.stringify(MessageV2.toModelMessage(messages))}
            </conversation>
            `,
          },
        ],
      })

      const userMsg = messages.find((m) => m.info.id === input.messageID)!
      userMsg.info.summary = {
        text: result.text,
        diffs: [],
      }
      await Session.updateMessage(userMsg.info)
    },
  )
}
