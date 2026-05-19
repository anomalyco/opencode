// Diagnostic suite for /event SSE delivery.
//
// Each test isolates ONE variable in the publisher chain while keeping the
// subscriber path constant (raw `app().request` reading the SSE body — no SDK
// consumer involvement). The pass/fail pattern across tests tells us where the
// bug lives:
//
//   D1 (baseline): publish via Bus.Service.use via AppRuntime — mirror of the
//        existing httpapi-event.test.ts test 3. Confirms /event SSE delivery
//        works for a SOME publish path.
//
//   D2: publish N times in quick succession via Bus.Service.use. If the bus
//        subscription is acquired correctly there should be no message loss.
//
//   D3: publish via SyncEvent.use.run via AppRuntime — exercises the same path
//        the HTTP handlers use (Session.updatePart → sync.run → bus.publish)
//        without the HTTP roundtrip. Tells us whether the sync path itself can
//        deliver in-process.
//
//   D4: publish via SyncEvent.use.run from a fresh `Effect.provide` scope
//        (mimicking what happens if a handler's layer was scoped per-request).
//
//   D5: in-process Bus.Service callback subscriber AND raw /event SSE subscriber
//        receive the same publish. If both receive: no bug. If only the
//        callback receives: the /event handler has an acquisition race.
import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { Event as ServerEvent } from "../../src/server/event"
import { SyncEvent } from "../../src/sync"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

type SseEvent = Schema.Schema.Type<typeof EventData>

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 3_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const textDecoder = new TextDecoder()

function decodeFrame(value: Uint8Array): SseEvent[] {
  // SSE frames are separated by blank lines and each starts with "data: ".
  // For our happy-path tests one chunk == one frame, but be defensive.
  const text = textDecoder.decode(value)
  return text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const payload = part.replace(/^data: /, "")
      return Schema.decodeUnknownSync(EventData)(JSON.parse(payload))
    })
}

async function readNextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 3_000): Promise<SseEvent> {
  const result = await readChunk(reader, timeoutMs)
  if (result.done || !result.value) throw new Error("event stream closed")
  const frames = decodeFrame(result.value)
  if (frames.length === 0) throw new Error("empty SSE frame")
  return frames[0]
}

async function collectUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: SseEvent) => boolean,
  timeoutMs = 3_000,
): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const result = await readChunk(reader, remaining).catch((cause) => {
      throw new Error(`collectUntil timed out after ${events.length} events: ${cause}`)
    })
    if (result.done || !result.value) throw new Error("event stream closed mid-collect")
    for (const event of decodeFrame(result.value)) {
      events.push(event)
      if (predicate(event)) return events
    }
  }
  throw new Error(`collectUntil deadline exceeded; collected ${events.length}: ${JSON.stringify(events)}`)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("/event SSE delivery diagnostics", () => {
  // Sanity: baseline same as httpapi-event.test.ts test 3 (already known to pass)
  // but explicit about timing — publish happens with NO wait after reading
  // server.connected. If this fails we have a deeper problem than just sync.
  test("D1: delivers a single bus event published right after server.connected", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()
    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      const ctx = await reloadTestInstance({ directory: tmp.path })
      // NO wait — publish immediately
      await AppRuntime.runPromise(
        Bus.Service.use((svc) => svc.publish(ServerEvent.Connected, {})).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const next = await readNextEvent(reader)
      expect(next.type).toBe("server.connected") // ServerEvent.Connected.type === "server.connected"
    } finally {
      await reader.cancel()
    }
  })

  // If D1 passes but D2 fails, we have a queue-drain or partial-loss issue.
  test("D2: delivers all N bus events published in rapid succession", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()
    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      const ctx = await reloadTestInstance({ directory: tmp.path })
      const N = 5
      for (let i = 0; i < N; i++) {
        await AppRuntime.runPromise(
          Bus.Service.use((svc) => svc.publish(ServerEvent.Connected, {})).pipe(
            Effect.provideService(InstanceRef, ctx),
          ),
        )
      }

      const received: SseEvent[] = []
      for (let i = 0; i < N; i++) {
        received.push(await readNextEvent(reader))
      }
      expect(received).toHaveLength(N)
      for (const event of received) expect(event.type).toBe("server.connected")
    } finally {
      await reader.cancel()
    }
  })

  // The critical test. If D1 passes but this fails, the bus-identity fix is
  // incomplete OR the sync.run publish path doesn't reach the same bus
  // /event subscribes to, even within the same AppRuntime.
  test("D3: delivers a SyncEvent published via SyncEvent.use.run after server.connected", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()
    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      const ctx = await reloadTestInstance({ directory: tmp.path })
      const sessionID = SessionID.make(`ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const part: MessageV2.Part = {
        id: partID,
        sessionID,
        messageID,
        type: "text",
        text: "diag",
      }

      await AppRuntime.runPromise(
        SyncEvent.use
          .run(MessageV2.Event.PartUpdated, {
            sessionID,
            part: structuredClone(part) as MessageV2.Part,
            time: Date.now(),
          })
          .pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const collected = await collectUntil(reader, (event) => event.type === MessageV2.Event.PartUpdated.type, 4_000)
      const updated = collected.find((event) => event.type === MessageV2.Event.PartUpdated.type)
      expect(updated).toBeDefined()
      expect((updated as any).properties.part.id).toBe(partID)
    } finally {
      await reader.cancel()
    }
  })

  // If D3 passes but D5 (the SDK E2E in httpapi-sdk.test.ts) fails, then the
  // bug is specifically in the cross-request / cross-fiber HTTP path, not in
  // the publish itself. If D3 also fails, the publish chain is broken.
  //
  // D4: ensure the publish reaches an in-process Bus subscriber too. Confirms
  // pub/sub identity end-to-end without involving /event SSE.
  test("D4: SyncEvent.use.run publish reaches an in-process Bus.Service.use callback", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const ctx = await reloadTestInstance({ directory: tmp.path })

    let resolveReceived: (event: { id: string; type: string; properties: unknown }) => void
    const received = new Promise<{ id: string; type: string; properties: unknown }>(
      (resolve) => (resolveReceived = resolve as typeof resolveReceived),
    )

    const dispose = await AppRuntime.runPromise(
      Bus.Service.use((svc) =>
        svc.subscribeAllCallback((event) => {
          if (event.type === MessageV2.Event.PartUpdated.type) resolveReceived(event)
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    )

    try {
      const sessionID = SessionID.make(`ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const part: MessageV2.Part = { id: partID, sessionID, messageID, type: "text", text: "diag-d4" }

      await AppRuntime.runPromise(
        SyncEvent.use
          .run(MessageV2.Event.PartUpdated, {
            sessionID,
            part: structuredClone(part) as MessageV2.Part,
            time: Date.now(),
          })
          .pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const event = await Promise.race([
        received,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("D4 timed out")), 3_000)),
      ])
      expect(event.type).toBe(MessageV2.Event.PartUpdated.type)
      expect((event.properties as any).part.id).toBe(partID)
    } finally {
      dispose()
    }
  })

  // D5: BOTH subscribers attached simultaneously. Trigger ONE publish via
  // SyncEvent.use.run. Both subscribers should receive it. If only one does
  // we know exactly which side of the chain is failing.
  test("D5: same SyncEvent.use.run publish reaches BOTH /event SSE and in-process callback", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const ctx = await reloadTestInstance({ directory: tmp.path })

    // In-process callback subscriber
    let resolveCallback: (event: { type: string; properties: unknown }) => void
    const callbackReceived = new Promise<{ type: string; properties: unknown }>(
      (resolve) => (resolveCallback = resolve as typeof resolveCallback),
    )
    const dispose = await AppRuntime.runPromise(
      Bus.Service.use((svc) =>
        svc.subscribeAllCallback((event) => {
          if (event.type === MessageV2.Event.PartUpdated.type) resolveCallback(event)
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    )

    // SSE subscriber via raw HTTP
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()

    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      const sessionID = SessionID.make(`ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const part: MessageV2.Part = { id: partID, sessionID, messageID, type: "text", text: "diag-d5" }

      await AppRuntime.runPromise(
        SyncEvent.use
          .run(MessageV2.Event.PartUpdated, {
            sessionID,
            part: structuredClone(part) as MessageV2.Part,
            time: Date.now(),
          })
          .pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const sseCollected = await collectUntil(
        reader,
        (event) => event.type === MessageV2.Event.PartUpdated.type,
        4_000,
      ).catch((err) => err as Error)
      const callbackResult = await Promise.race([
        callbackReceived,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
      ])

      const sseSaw =
        Array.isArray(sseCollected) && sseCollected.some((event) => event.type === MessageV2.Event.PartUpdated.type)
      const callbackSaw = callbackResult !== "timeout"

      // Both should see it. The reason we use a single assert with the boolean
      // pair is so the test failure message tells us exactly which side broke.
      expect({ sseSaw, callbackSaw }).toEqual({ sseSaw: true, callbackSaw: true })
    } finally {
      await reader.cancel()
      dispose()
    }
  })

  // D7: like D5 but the "second subscriber" is a NO-OP AppRuntime.runPromise
  // call (no PubSub.subscribe). If D7 passes, the specific subscribeAllCallback
  // is what breaks SSE — not arbitrary AppRuntime usage. If D7 fails, anything
  // running through AppRuntime concurrently with /event SSE breaks delivery.
  test("D7: SSE receives sync.run publish even with concurrent no-op AppRuntime activity", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const ctx = await reloadTestInstance({ directory: tmp.path })

    // No-op: just touches the runtime, no bus interaction
    await AppRuntime.runPromise(Effect.void)

    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()
    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      const sessionID = SessionID.make(`ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const part: MessageV2.Part = { id: partID, sessionID, messageID, type: "text", text: "diag-d7" }

      await AppRuntime.runPromise(
        SyncEvent.use
          .run(MessageV2.Event.PartUpdated, {
            sessionID,
            part: structuredClone(part) as MessageV2.Part,
            time: Date.now(),
          })
          .pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const collected = await collectUntil(reader, (event) => event.type === MessageV2.Event.PartUpdated.type, 4_000)
      const updated = collected.find((event) => event.type === MessageV2.Event.PartUpdated.type)
      expect(updated).toBeDefined()
    } finally {
      await reader.cancel()
    }
  })

  // D6: same as D5 but the callback subscriber is attached AFTER /event SSE
  // subscription is established. If D5 fails and D6 passes, the order of
  // subscriber setup is the determining factor.
  test("D6: /event SSE receives sync.run publish when callback is attached AFTER /event opens", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const ctx = await reloadTestInstance({ directory: tmp.path })

    // Open SSE FIRST
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")
    const reader = response.body.getReader()

    try {
      const first = await readNextEvent(reader)
      expect(first.type).toBe("server.connected")

      // THEN attach callback subscriber
      let resolveCallback: (event: { type: string; properties: unknown }) => void
      const callbackReceived = new Promise<{ type: string; properties: unknown }>(
        (resolve) => (resolveCallback = resolve as typeof resolveCallback),
      )
      const dispose = await AppRuntime.runPromise(
        Bus.Service.use((svc) =>
          svc.subscribeAllCallback((event) => {
            if (event.type === MessageV2.Event.PartUpdated.type) resolveCallback(event)
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      try {
        const sessionID = SessionID.make(`ses_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const part: MessageV2.Part = { id: partID, sessionID, messageID, type: "text", text: "diag-d6" }

        await AppRuntime.runPromise(
          SyncEvent.use
            .run(MessageV2.Event.PartUpdated, {
              sessionID,
              part: structuredClone(part) as MessageV2.Part,
              time: Date.now(),
            })
            .pipe(Effect.provideService(InstanceRef, ctx)),
        )

        const sseCollected = await collectUntil(
          reader,
          (event) => event.type === MessageV2.Event.PartUpdated.type,
          4_000,
        ).catch((err) => err as Error)
        const callbackResult = await Promise.race([
          callbackReceived,
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
        ])

        const sseSaw =
          Array.isArray(sseCollected) && sseCollected.some((event) => event.type === MessageV2.Event.PartUpdated.type)
        const callbackSaw = callbackResult !== "timeout"
        expect({ sseSaw, callbackSaw }).toEqual({ sseSaw: true, callbackSaw: true })
      } finally {
        dispose()
      }
    } finally {
      await reader.cancel()
    }
  })
})
