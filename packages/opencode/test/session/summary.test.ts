import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("SessionSummary", () => {
  test("deduplicates identical in-flight summarize calls", async () => {
    await using tmp = await tmpdir()

    const gate = defer<void>()
    let diffCalls = 0
    let messageCalls = 0
    let summaryCalls = 0
    let updateCalls = 0
    const sessionID = SessionID.make("ses_summary_test")
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const providerID = ProviderID.make("test")
    const modelID = ModelID.make("test-model")
    const msgs = [
      {
        info: {
          id: userID,
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID, modelID },
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: userID,
            sessionID,
            type: "text",
            text: "hi",
          },
        ],
      },
      {
        info: {
          id: assistantID,
          sessionID,
          role: "assistant",
          parentID: userID,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID,
          providerID,
          time: { created: Date.now() },
          finish: "stop",
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: assistantID,
            sessionID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending(),
            messageID: assistantID,
            sessionID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ],
      },
    ] satisfies MessageV2.WithParts[]

    const layer = Layer.mergeAll(
      Layer.succeed(
        Session.Service,
        Session.Service.of({
          messages: () => {
            messageCalls++
            return Effect.succeed(msgs)
          },
          setSummary: () => {
            summaryCalls++
            return Effect.void
          },
          updateMessage: <T extends MessageV2.Info>(msg: T) => {
            updateCalls++
            return Effect.succeed(msg)
          },
        } as any),
      ),
      Layer.succeed(
        Snapshot.Service,
        Snapshot.Service.of({
          diffFull: () =>
            Effect.gen(function* () {
              diffCalls++
              yield* Effect.promise(() => gate.promise)
              return [{ file: "a.ts", before: "", after: "x", additions: 1, deletions: 0 }]
            }),
        } as any),
      ),
      Layer.succeed(
        Storage.Service,
        Storage.Service.of({
          write: () => Effect.void,
        } as any),
      ),
      Layer.succeed(
        Bus.Service,
        Bus.Service.of({
          publish: () => Effect.void,
        } as any),
      ),
    )

    const rt = ManagedRuntime.make(SessionSummary.layer.pipe(Layer.provide(layer)))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const body = SessionSummary.Service.use((svc) => svc.summarize({ sessionID, messageID: userID }))
          const a = rt.runPromise(body)
          const b = rt.runPromise(body)
          await Bun.sleep(10)
          expect(messageCalls).toBe(1)
          expect(diffCalls).toBe(1)
          gate.resolve()
          await Promise.all([a, b])
        },
      })
    } finally {
      await rt.dispose()
    }

    expect(summaryCalls).toBe(1)
    expect(updateCalls).toBe(1)
  })
})
