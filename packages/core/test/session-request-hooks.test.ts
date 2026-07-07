import { describe, expect, it } from "bun:test"
import { Message, SystemPart } from "@opencode-ai/llm"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Layer } from "effect"
import { SessionRequestHooks } from "../src/session/request-hooks"

describe("SessionRequestHooks", () => {
  it("runs scoped hooks sequentially against one mutable event", async () => {
    const seen: string[] = []
    const program = Effect.gen(function* () {
      const service = yield* SessionRequestHooks.Service
      yield* service.before((event) => {
          seen.push("first")
          event.system.push(SystemPart.make("second"))
          event.tools.read.description = "changed"
          delete event.tools.write
        })
      yield* service.before((event) =>
        Effect.sync(() => {
            seen.push(event.system[1]?.text ?? "missing")
            event.messages = [Message.user("changed")]
        }),
      )

      const event: SessionRequestHooks.BeforeEvent = {
        sessionID: Session.ID.make("ses_request_hooks"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        system: [SystemPart.make("first")],
        messages: [Message.user("original")],
        tools: {
          read: { description: "read", input: { type: "object" } },
          write: { description: "write", input: { type: "object" } },
        },
      }
      yield* service.runBefore(event)

      expect(seen).toEqual(["first", "second"])
      expect(event.system.map((part) => part.text)).toEqual(["first", "second"])
      expect(event.messages).toEqual([Message.user("changed")])
      expect(event.tools).toEqual({ read: { description: "changed", input: { type: "object" } } })
    })

    await Effect.runPromise(
      Effect.scoped(program).pipe(
        Effect.provide(SessionRequestHooks.node.implementation as Layer.Layer<SessionRequestHooks.Service>),
      ),
    )
  })
})
