import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionContext, SessionPrompt } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { DateTime, Effect, Stream } from "effect"
import { GenUI } from "../src/genui"
import { GenUISession } from "../src/session"

const sessionID = Session.ID.make("ses_genui_test")

/** Registers the plugin's session hooks against stubs, recording the reminders it persists. */
const run = async () => {
  const persisted: string[] = []
  const hooks: {
    prompt?: (input: SessionPrompt) => Effect.Effect<void>
    context?: (input: SessionContext) => Effect.Effect<void>
  } = {}
  const session: Pick<Context["session"], "hook" | "synthetic"> = {
    hook: (name, callback) => {
      // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
      if (name === "prompt") hooks.prompt = callback as (input: SessionPrompt) => Effect.Effect<void>
      if (name === "context") hooks.context = callback as (input: SessionContext) => Effect.Effect<void>
      return Effect.succeed({ dispose: Effect.void })
    },
    synthetic: (input) => {
      persisted.push(input.text)
      return Effect.succeed(
        SessionInbox.Synthetic.make({
          id: SessionMessage.ID.make("msg_genui_test"),
          sessionID,
          time: { created: DateTime.makeUnsafe(0) },
          type: "synthetic",
          payload: { text: input.text },
          delivery: "steer",
        }),
      )
    },
  }
  await Effect.runPromise(
    GenUISession.register({ session, event: { subscribe: () => Stream.empty } }).pipe(Effect.scoped),
  )
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
  return { persisted, prompt, context }
}

describe("GenUISession", () => {
  test("tells the agent once, from the prompt that turns generated UI on, and offers the render tool", async () => {
    const plugin = await run()
    await plugin.prompt({ genui: true })
    expect(plugin.persisted).toHaveLength(1)
    expect(plugin.persisted[0]).toContain(GenUI.RENDER_TOOL)

    const request = await plugin.context([Message.user(plugin.persisted[0] ?? ""), Message.user("Show me the build")])
    await plugin.prompt({ genui: true })

    expect(Object.keys(request.tools)).toEqual([GenUI.RENDER_TOOL, "read"])
    expect(request.messages).toHaveLength(2)
    expect(plugin.persisted).toHaveLength(1)
  })

  test("hides the render tool and says so once a prompt comes without generated UI", async () => {
    const plugin = await run()
    await plugin.prompt({ genui: true })
    await plugin.prompt({ genui: false })
    await plugin.prompt({ genui: false })
    const request = await plugin.context([Message.user("Text only now")])

    expect(Object.keys(request.tools)).toEqual(["read"])
    expect(request.messages).toHaveLength(1)
    expect(plugin.persisted).toHaveLength(2)
    expect(plugin.persisted[1]).toContain("no longer available")
  })

  test("never offers the render tool to a session the app has not prompted, such as a subagent", async () => {
    const plugin = await run()
    const request = await plugin.context([Message.user("Search the repo")])

    expect(Object.keys(request.tools)).toEqual(["read"])
    expect(plugin.persisted).toEqual([])
  })
})
