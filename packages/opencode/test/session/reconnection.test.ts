import { describe, test, expect } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionProcessor } from "../../src/session/processor"
import { SessionStatus } from "../../src/session/status"
import { SessionRetry } from "../../src/session/retry"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { LLM } from "../../src/session/llm"
import type { Provider } from "../../src/provider/provider"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  api: { id: "test", url: "http://localhost:9999", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: false,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2024-01-01",
}

async function makeMsg() {
  const session = await Session.create({})
  const userID = MessageID.ascending()
  await Session.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
  } as unknown as MessageV2.Info)
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "assistant",
    time: { created: Date.now() },
    parentID: userID,
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    mode: "primary",
    agent: "build",
    path: { cwd: projectRoot, root: projectRoot },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  await Session.updateMessage(msg)
  return { session, msg }
}

async function* sseTimeout() {
  yield { type: "start" }
  throw new Error("SSE read timed out")
}

async function* ok() {
  yield { type: "start" }
}

type Reconnecting = Extract<SessionStatus.Info, { type: "reconnecting" }>

describe("session.processor.reconnection", () => {
  test("busy → reconnecting(1) → busy → success with partial part cleanup", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, msg } = await makeMsg()

        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: msg.id,
          type: "text",
          text: "pre-existing partial",
          time: { start: Date.now() },
        })

        const statuses: SessionStatus.Info[] = []
        const unsub = Bus.subscribe(SessionStatus.Event.Status, (e) => {
          statuses.push(e.properties.status)
        })

        const [prevStream, prevSleep] = [LLM.stream, SessionRetry.sleep]
        ;(SessionRetry as any).sleep = async () => {}

        let call = 0
        ;(LLM as any).stream = async () => {
          call++
          return { fullStream: call === 1 ? sseTimeout() : ok() }
        }

        const ctrl = new AbortController()
        const proc = SessionProcessor.create({
          assistantMessage: msg,
          sessionID: session.id,
          model,
          abort: ctrl.signal,
        })

        const result = await proc.process({} as unknown as LLM.StreamInput)

        ;(LLM as any).stream = prevStream
        ;(SessionRetry as any).sleep = prevSleep
        unsub()

        expect(call).toBe(2)
        expect(result).toBe("continue")

        const reconnecting = statuses.filter((s): s is Reconnecting => s.type === "reconnecting")
        expect(reconnecting.length).toBe(1)
        expect(reconnecting[0].attempt).toBe(1)
        expect(reconnecting[0].message).toBe("SSE read timed out")

        expect(statuses.filter((s) => s.type === "busy").length).toBeGreaterThanOrEqual(2)

        const parts = await MessageV2.parts(msg.id)
        const text = parts.find((p): p is MessageV2.TextPart => p.type === "text")
        expect(text).toBeDefined()
        expect(text?.text).toBe("")

        await Session.remove(session.id)
      },
    })
  }, 30_000)

  test("max network retries exhausted: 5 reconnecting states → idle with error → stop", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, msg } = await makeMsg()

        const statuses: SessionStatus.Info[] = []
        const unsub = Bus.subscribe(SessionStatus.Event.Status, (e) => {
          statuses.push(e.properties.status)
        })

        const [prevStream, prevSleep] = [LLM.stream, SessionRetry.sleep]
        ;(SessionRetry as any).sleep = async () => {}
        ;(LLM as any).stream = async () => ({ fullStream: sseTimeout() })

        const ctrl = new AbortController()
        const proc = SessionProcessor.create({
          assistantMessage: msg,
          sessionID: session.id,
          model,
          abort: ctrl.signal,
        })

        const result = await proc.process({} as unknown as LLM.StreamInput)

        ;(LLM as any).stream = prevStream
        ;(SessionRetry as any).sleep = prevSleep
        unsub()

        expect(result).toBe("stop")

        const reconnecting = statuses.filter((s): s is Reconnecting => s.type === "reconnecting")
        expect(reconnecting.length).toBe(5)
        expect(reconnecting.map((s) => s.attempt)).toStrictEqual([1, 2, 3, 4, 5])

        expect(statuses.at(-1)?.type).toBe("idle")

        await Session.remove(session.id)
      },
    })
  }, 30_000)
})
