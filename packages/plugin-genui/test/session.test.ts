import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionContext, SessionPrompt } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import type { InstructionEntry } from "@opencode/schema/instruction-entry"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect, type Schema } from "effect"
import { GenUI } from "../src/genui"
import { GenUISession } from "../src/session"

const sessionID = Session.ID.make("ses_genui_test")

/** Registers the plugin's session hooks against an instruction-entry store, recording each put. */
const run = async (store = new Map<InstructionEntry.Key, Schema.Json>()) => {
  const puts: Array<{ key: InstructionEntry.Key; value: Schema.Json }> = []
  const hooks: {
    prompt?: (input: SessionPrompt) => Effect.Effect<void>
    context?: (input: SessionContext) => Effect.Effect<void>
  } = {}
  const session: Pick<Context["session"], "hook" | "instructions"> = {
    hook: (name, callback) => {
      // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
      if (name === "prompt") hooks.prompt = callback as (input: SessionPrompt) => Effect.Effect<void>
      if (name === "context") hooks.context = callback as (input: SessionContext) => Effect.Effect<void>
      return Effect.succeed({ dispose: Effect.void })
    },
    instructions: {
      entry: {
        list: () => Effect.sync(() => Array.from(store, ([key, value]) => ({ key, value }))),
        put: (input) =>
          Effect.sync(() => {
            store.set(input.key, input.value)
            puts.push({ key: input.key, value: input.value })
          }),
        remove: (input) =>
          Effect.sync(() => {
            store.delete(input.key)
          }),
      },
    },
  }
  await Effect.runPromise(GenUISession.register({ session }).pipe(Effect.scoped))
  const prompt = (metadata?: Record<string, unknown>) =>
    Effect.runPromise(
      hooks.prompt?.({
        sessionID,
        messageID: SessionMessage.ID.make("msg_prompt"),
        prompt: { text: "hi" },
        metadata,
        delivery: "steer",
      }) ?? Effect.void,
    )
  const context = async (messages: Message[]) => {
    const request: SessionContext = {
      sessionID,
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("test") },
      system: [],
      messages,
      tools: { [GenUI.RENDER_TOOL]: { description: "", input: {} }, read: { description: "", input: {} } },
      options: {},
    }
    await Effect.runPromise(hooks.context?.(request) ?? Effect.void)
    return request
  }
  return { puts, store, prompt, context }
}

describe("GenUISession", () => {
  test("offers the render tool and puts the instruction entry once while the app shows generated UI", async () => {
    const plugin = await run()
    await plugin.prompt({ genui: true })
    const initial = [Message.user("Show me the build")]
    const first = await plugin.context([...initial])

    expect(Object.keys(first.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(plugin.puts).toEqual([{ key: GenUISession.KEY, value: expect.stringContaining(GenUI.RENDER_TOOL) }])
    expect(plugin.puts[0]?.value).not.toContain("<system-reminder>")
    expect(first.messages).toEqual(initial)

    await plugin.prompt({ genui: true })
    const second = await plugin.context([Message.user("Show me the build"), Message.user("Again")])
    expect(Object.keys(second.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(plugin.puts).toHaveLength(1)
    expect(second.messages).toHaveLength(2)
  })

  test("updates the instruction entry once when a prompt comes without generated UI, keeping the tool list stable", async () => {
    const plugin = await run()
    await plugin.prompt({ genui: true })
    await plugin.context([Message.user("hi")])
    await plugin.prompt({ genui: false })
    const request = await plugin.context([Message.user("hi"), Message.user("Text only now")])

    expect(Object.keys(request.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(plugin.puts).toHaveLength(2)
    expect(plugin.puts[1]).toEqual({ key: GenUISession.KEY, value: expect.stringContaining("no longer available") })

    await plugin.prompt(undefined)
    await plugin.context([Message.user("hi"), Message.user("Text only now"), Message.user("Still text")])
    expect(plugin.puts).toHaveLength(2)
  })

  test("keeps the tool list and availability state after a restart", async () => {
    const store = new Map<InstructionEntry.Key, Schema.Json>()
    const before = await run(store)
    await before.prompt({ genui: true })
    await before.context([Message.user("hi")])

    const after = await run(store)
    const request = await after.context([Message.user("hi"), Message.user("next")])

    expect(Object.keys(request.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(after.puts).toEqual([])

    await after.prompt({ genui: true })
    expect(after.puts).toEqual([])

    await after.prompt({ genui: false })
    const left = await after.context([Message.user("hi"), Message.user("next"), Message.user("off")])
    expect(Object.keys(left.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(after.puts).toEqual([{ key: GenUISession.KEY, value: expect.stringContaining("no longer available") }])
  })

  test("never offers the render tool or writes an entry for a session the app has not prompted, such as a subagent", async () => {
    const plugin = await run()
    await plugin.prompt(undefined)
    const request = await plugin.context([Message.user("Search the repo")])

    expect(Object.keys(request.tools)).toEqual(["read"])
    expect(plugin.puts).toEqual([])
    expect(plugin.store.size).toBe(0)
  })
})
