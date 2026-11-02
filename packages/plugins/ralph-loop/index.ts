import { Plugin } from "@opencode/plugin"
import { decide, initialState, parseCommand, renderKickoff, type State } from "./state.js"

const PREFIX = "session:"
const boot = crypto.randomUUID()

type Stored = State & { readonly boot: string }

function assistantText(messages: ReadonlyArray<unknown>): string {
  const parts: string[] = []
  for (const message of messages) {
    const item = message as { type?: string; content?: Array<{ type?: string; text?: string }> }
    if (item.type !== "assistant" || !item.content) continue
    for (const part of item.content) if (part.type === "text" && typeof part.text === "string") parts.push(part.text)
  }
  return parts.join("\n")
}

export default Plugin.define({
  id: "opencode.ralph-loop",
  async setup(ctx) {
    const read = async (sessionID: string): Promise<Stored | undefined> => {
      const value = await ctx.storage.get(PREFIX + sessionID)
      return value as Stored | undefined
    }
    const write = async (sessionID: string, state: Stored | undefined) => {
      if (state) await ctx.storage.set(PREFIX + sessionID, state)
      else await ctx.storage.remove(PREFIX + sessionID)
    }
    const clearInstruction = (sessionID: string) =>
      ctx.session.instructions.entry.remove({ sessionID, key: "ralph-loop" }).catch(() => {})

    await ctx.command.transform((editor) => {
      editor.add({
        name: "ralph-loop",
        description: "repeat the same prompt until a completion marker or a maximum number of iterations",
        execute: async (input) => {
          const parsed = parseCommand(input.prompt.text)
          if ("error" in parsed) throw new Error(parsed.error)
          const state: Stored = { ...initialState(parsed), boot }
          await write(input.sessionID, state)
          await ctx.session.instructions.entry.put({
            sessionID: input.sessionID,
            key: "ralph-loop",
            value: renderKickoff(parsed.prompt, parsed.completion),
          })
          await ctx.session.synthetic({
            sessionID: input.sessionID,
            text: renderKickoff(parsed.prompt, parsed.completion),
            description: `Ralph loop: ${parsed.prompt.slice(0, 100)}`,
            metadata: { source: "ralph-loop" },
          })
        },
      })
      editor.add({
        name: "cancel-ralph",
        description: "cancel the active Ralph loop in this session",
        execute: async (input) => {
          await write(input.sessionID, undefined)
          await clearInstruction(input.sessionID)
        },
      })
    })

    await ctx.session.hook("experimental.idle", async (event) => {
      const state = await read(event.sessionID)
      if (state?.status !== "active") return
      if (state.boot !== boot) {
        await write(event.sessionID, {
          ...state,
          status: "paused",
          reason: "The server restarted while the loop was active",
        })
        await clearInstruction(event.sessionID)
        return
      }
      // A running shell or subagent of this session wakes it again when it finishes.
      if (event.background.some((work) => work.sessionID === event.sessionID)) return

      const messages = await ctx.session.context({ sessionID: event.sessionID })
      const decision = decide({ state, assistantText: assistantText(messages) })
      await write(event.sessionID, { ...decision.state, boot: state.boot })
      if (decision.kind !== "continue") {
        await clearInstruction(event.sessionID)
        return
      }
      await ctx.session.synthetic({
        sessionID: event.sessionID,
        text: decision.text,
        metadata: { source: "ralph-loop" },
      })
    })
  },
})
