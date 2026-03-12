import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { PartID, MessageID, SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const model = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-5.2"),
}

async function parts(sessionID: SessionID) {
  const msgs = await Session.messages({ sessionID })
  return msgs.flatMap((msg) => msg.parts.filter((part) => part.type === "text").map((part) => part.text))
}

async function wait(check: () => Promise<boolean>) {
  for (let i = 0; i < 20; i++) {
    if (await check()) return
    await Bun.sleep(5)
  }
  throw new Error("timed out waiting for background result")
}

describe("session.prompt /btw", () => {
  test("appends todos immediately", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "todo follow up on logs",
        })

        await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "todo file a note",
        })

        expect(result.info.role).toBe("assistant")
        expect(Todo.get(session.id)).toEqual([
          {
            content: "follow up on logs",
            status: "pending",
            priority: "medium",
          },
          {
            content: "file a note",
            status: "pending",
            priority: "medium",
          },
        ])
        expect(await parts(session.id)).toContain("Added todo: follow up on logs")

        await Session.remove(session.id)
      },
    })
  })

  test("creates a child session and reports completion back to parent", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "ask what changed?",
          run: async (input) => ({
            info: {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: MessageID.ascending(),
              mode: input.agent ?? "build",
              agent: input.agent ?? "build",
              cost: 0,
              path: {
                cwd: Instance.directory,
                root: Instance.worktree,
              },
              time: {
                created: Date.now(),
                completed: Date.now(),
              },
              role: "assistant",
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
              modelID: input.model?.modelID ?? model.modelID,
              providerID: input.model?.providerID ?? model.providerID,
            } satisfies MessageV2.Assistant,
            parts: [
              {
                id: PartID.ascending(),
                messageID: MessageID.ascending(),
                sessionID: input.sessionID,
                type: "text",
                text: "background answer",
              } satisfies MessageV2.TextPart,
            ],
          }),
        })

        expect(result.info.role).toBe("assistant")
        await wait(
          async () =>
            (await Session.children(session.id)).length === 1 &&
            (await parts(session.id)).some((item) => item.includes("background answer")),
        )

        const kids = await Session.children(session.id)
        expect(kids).toHaveLength(1)
        const msgs = await Session.messages({ sessionID: session.id })
        expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
        const text = await parts(session.id)
        expect(text.some((item) => item.includes("Started background task in child session"))).toBe(true)
        expect(text.some((item) => item.includes("background answer"))).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("reports background child status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        let done = false

        await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "ask first",
          run: async (input) => {
            SessionStatus.set(input.sessionID, { type: "busy" })
            while (!done) await Bun.sleep(5)
            SessionStatus.set(input.sessionID, { type: "idle" })
            return {
              info: {
                id: MessageID.ascending(),
                sessionID: input.sessionID,
                parentID: MessageID.ascending(),
                mode: input.agent ?? "build",
                agent: input.agent ?? "build",
                cost: 0,
                path: {
                  cwd: Instance.directory,
                  root: Instance.worktree,
                },
                time: {
                  created: Date.now(),
                  completed: Date.now(),
                },
                role: "assistant",
                tokens: {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
                modelID: input.model?.modelID ?? model.modelID,
                providerID: input.model?.providerID ?? model.providerID,
              } satisfies MessageV2.Assistant,
              parts: [
                {
                  id: PartID.ascending(),
                  messageID: MessageID.ascending(),
                  sessionID: input.sessionID,
                  type: "text",
                  text: "done later",
                } satisfies MessageV2.TextPart,
              ],
            }
          },
        })

        await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "ask second",
          run: async (input) => {
            const info = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: MessageID.ascending(),
              mode: input.agent ?? "build",
              agent: input.agent ?? "build",
              cost: 0,
              path: {
                cwd: Instance.directory,
                root: Instance.worktree,
              },
              time: {
                created: Date.now(),
                completed: Date.now(),
              },
              role: "assistant",
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
              modelID: input.model?.modelID ?? model.modelID,
              providerID: input.model?.providerID ?? model.providerID,
            } satisfies MessageV2.Assistant
            const part = {
              id: PartID.ascending(),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              text: "finished already",
            } satisfies MessageV2.TextPart
            await Session.updateMessage(info)
            await Session.updatePart(part)
            return {
              info,
              parts: [part],
            }
          },
        })

        await wait(async () => (await Session.children(session.id)).length === 2)
        const result = await SessionPrompt.commandBtw({
          sessionID: session.id,
          agent: "build",
          model,
          arguments: "status",
        })

        const value = result.parts.find((part) => part.type === "text")
        expect(value?.text.includes("running")).toBe(true)
        expect(value?.text.includes("finished already")).toBe(true)

        done = true
        await wait(async () => (await parts(session.id)).some((item) => item.includes("done later")))
        await Session.remove(session.id)
      },
    })
  })
})
