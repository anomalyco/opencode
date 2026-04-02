import { Session } from "."
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { Provider } from "../provider/provider"
import { Permission } from "@/permission"
import { fn } from "@/util/fn"
import { ProviderID } from "@/provider/schema"
import { ModelID } from "@/provider/schema"
import z from "zod"

export namespace Sidekick {
  /**
   * Get or create a sidekick session for the given parent session.
   * Each parent session has at most one sidekick session.
   */
  export const ensure = fn(SessionID.zod, async (parentID) => {
    const parent = await Session.get(parentID)
    if (parent.kind === "sidekick") throw new Error("Cannot create a sidekick of a sidekick session")

    const children = await Session.children(parentID)
    const existing = children.find((c) => c.kind === "sidekick")
    if (existing) return existing

    try {
      return await Session.create({
        parentID,
        kind: "sidekick",
        title: "Sidekick",
        permission: Permission.fromConfig({
          "*": "deny",
        }),
      })
    } catch (err) {
      // TOCTOU: another concurrent ensure() may have created it
      const retry = await Session.children(parentID)
      const found = retry.find((c) => c.kind === "sidekick")
      if (found) return found
      throw err
    }
  })

  /**
   * Build a context snapshot from the parent session's recent messages.
   * Returns a formatted string of the last N messages.
   */
  export const context = fn(
    z.object({
      parentID: SessionID.zod,
      limit: z.number().default(30),
    }),
    async (input) => {
      const msgs = await Session.messages({ sessionID: input.parentID, limit: input.limit })
      if (msgs.length === 0) return ""

      const lines: string[] = ["<main_conversation>"]
      for (const msg of msgs) {
        const role = msg.info.role
        const text = msg.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
          .map((p) => p.text)
          .join("\n")
        const tools = msg.parts.filter((p): p is MessageV2.ToolPart => p.type === "tool")

        if (role === "user") {
          if (!text.trim()) continue
          lines.push(`[User]: ${text}`)
        }
        if (role === "assistant") {
          const toolSummary = tools
            .map((t) => {
              const title = t.state.status === "completed" || t.state.status === "running" ? t.state.title : undefined
              return title ? `${t.tool}(${title})` : `${t.tool}[${t.state.status}]`
            })
            .join(", ")
          if (!text.trim() && !toolSummary) continue
          const prefix = toolSummary ? ` (tools: ${toolSummary})` : ""
          lines.push(`[Assistant${prefix}]: ${text || "(working...)"}`)
        }
      }
      lines.push("</main_conversation>")
      return lines.join("\n")
    },
  )

  /**
   * Send a message to the sidekick session.
   * Automatically injects parent conversation context as a synthetic text part.
   */
  export const prompt = fn(
    z.object({
      parentID: SessionID.zod,
      text: z.string(),
      model: z
        .object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
        })
        .optional(),
    }),
    async (input) => {
      const session = await ensure(input.parentID)
      const snapshot = await context({ parentID: input.parentID, limit: 30 })

      const parts: SessionPrompt.PromptInput["parts"] = []

      if (snapshot) {
        parts.push({
          type: "text",
          text: snapshot,
          synthetic: true,
        })
      }

      parts.push({
        type: "text",
        text: input.text,
      })

      const model = input.model ?? (await Provider.defaultModel())
      return SessionPrompt.prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "sidekick",
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        parts,
      })
    },
  )

  /**
   * Inject a sidekick message into the parent conversation as a user message.
   * Retrieves the last user message's agent/model to maintain consistency.
   */
  export const inject = fn(
    z.object({
      parentID: SessionID.zod,
      text: z.string(),
    }),
    async (input) => {
      // Get last user message to reuse agent + model
      const msgs = await Session.messages({ sessionID: input.parentID, limit: 10 })
      let agent = "build"
      let model = await Provider.defaultModel()
      for (let i = msgs.length - 1; i >= 0; i--) {
        const info = msgs[i].info
        if (info.role === "user") {
          agent = info.agent
          model = info.model
          break
        }
      }

      const id = MessageID.ascending()
      const msg: MessageV2.User = {
        id,
        sessionID: input.parentID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent,
        model,
      }
      await Session.updateMessage(msg)

      await Session.updatePart({
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.parentID,
        type: "text",
        text: `[Injected from Sidekick]: ${input.text}`,
      } satisfies MessageV2.TextPart)

      return msg
    },
  )
}
