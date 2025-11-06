import { Provider } from "@/provider/provider"
import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."
import { generateText, type ModelMessage } from "ai"
import { MessageV2 } from "./message-v2"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"
import { Log } from "@/util/log"
import path from "path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"

export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" })

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      const all = await Session.messages(input.sessionID)
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ])
    },
  )

  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    const files = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === "patch")
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x)),
    )
    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((x) => {
        return files.has(x.file)
      }),
    )
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      }
    })
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    const messages = input.messages.filter(
      (m) =>
        m.info.id === input.messageID ||
        (m.info.role === "assistant" && m.info.parentID === input.messageID),
    )
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)!
    const userMsg = msgWithParts.info as MessageV2.User
    const diffs = await computeDiff({ messages })
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg)

    const assistantMsg = messages.find((m) => m.info.role === "assistant")!
      .info as MessageV2.Assistant
    const small = await Provider.getSmallModel(assistantMsg.providerID)
    if (!small) return

    const textPart = msgWithParts.parts.find(
      (p) => p.type === "text" && !p.synthetic,
    ) as MessageV2.TextPart
    if (textPart && !userMsg.summary?.title) {
      const result = await generateText({
        maxOutputTokens: small.info.reasoning ? 1500 : 20,
        providerOptions: ProviderTransform.providerOptions(small.npm, small.providerID, {}),
        messages: [
          ...SystemPrompt.title(small.providerID).map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          {
            role: "user" as const,
            content: `
              The following is the text to summarize:
              <text>
              ${textPart?.text ?? ""}
              </text>
            `,
          },
        ],
        headers: small.info.headers,
        model: small.language,
      })
      log.info("title", { title: result.text })
      userMsg.summary.title = result.text
      await Session.updateMessage(userMsg)
    }

    if (
      messages.some(
        (m) =>
          m.info.role === "assistant" &&
          m.parts.some((p) => p.type === "step-finish" && p.reason !== "tool-calls"),
      )
    ) {
      let summary = messages
        .findLast((m) => m.info.role === "assistant")
        ?.parts.findLast((p) => p.type === "text")?.text
      if (!summary || diffs.length > 0) {
        const result = await generateText({
          model: small.language,
          maxOutputTokens: 100,
          messages: [
            {
              role: "user",
              content: `
            Summarize the following conversation into 2 sentences MAX explaining what the assistant did and why. Do not explain the user's input. Do not speak in the third person about the assistant.
            <conversation>
            ${JSON.stringify(MessageV2.toModelMessage(messages))}
            </conversation>
            `,
            },
          ],
          headers: small.info.headers,
        }).catch(() => {})
        if (result) summary = result.text
      }
      userMsg.summary.body = summary
      log.info("body", { body: summary })
      await Session.updateMessage(userMsg)
    }
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      let all = await Session.messages(input.sessionID)
      if (input.messageID)
        all = all.filter(
          (x) =>
            x.info.id === input.messageID ||
            (x.info.role === "assistant" && x.info.parentID === input.messageID),
        )

      return computeDiff({
        messages: all,
      })
    },
  )

  async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    // scan assistant messages to find earliest from and latest to
    // snapshot
    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
          break
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to)
    return []
  }
}
