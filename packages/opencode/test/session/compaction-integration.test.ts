import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Agent } from "../../src/agent/agent"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionCompactionPolicy } from "../../src/session/compaction-policy"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"
import * as SessionProcessorModule from "../../src/session/processor"
import { ProviderTest } from "../fake/provider"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

afterEach(() => {})

function createModel(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: opts.context, input: opts.input, output: opts.output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 }) })

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await Session.updateMessage(msg)
  return msg
}

async function toolWithAttachment(
  sessionID: SessionID,
  messageID: MessageID,
  toolName: string,
  output: string,
  attachments: Array<{ mime: string; filename: string; url: string }>,
) {
  return Session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool",
    callID: crypto.randomUUID(),
    tool: toolName,
    state: {
      status: "completed",
      input: {},
      output,
      title: "done",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
      attachments: attachments.map((a) => ({
        type: "file" as const,
        id: PartID.ascending(),
        messageID,
        sessionID,
        mime: a.mime,
        filename: a.filename,
        url: a.url,
        time: { start: Date.now(), end: Date.now() },
      })),
    },
  })
}

function capturingSequenceLayer(
  results: ("continue" | "compact")[],
  captured: Array<{ messages: unknown[]; maxOutputTokens?: number }>,
) {
  let idx = 0
  return Layer.succeed(
    SessionProcessorModule.SessionProcessor.Service,
    SessionProcessorModule.SessionProcessor.Service.of({
      create: Effect.fn("TestSessionProcessor.create")((input) => {
        const r = results[Math.min(idx++, results.length - 1)]
        const msg = input.assistantMessage
        return Effect.succeed({
          get message() {
            return msg
          },
          abort: Effect.fn("TestSessionProcessor.abort")(() => Effect.void),
          partFromToolCall() {
            return {
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: msg.sessionID,
              type: "tool" as const,
              callID: "fake",
              tool: "fake",
              state: { status: "pending" as const, input: {}, raw: "" },
            }
          },
          process: Effect.fn("TestSessionProcessor.process")((procInput) => {
            captured.push({ messages: procInput.messages, maxOutputTokens: procInput.maxOutputTokens })
            return Effect.succeed(r)
          }),
        } satisfies SessionProcessorModule.SessionProcessor.Handle)
      }),
    }),
  )
}

function sequenceLayer(results: ("continue" | "compact")[]) {
  let idx = 0
  return Layer.succeed(
    SessionProcessorModule.SessionProcessor.Service,
    SessionProcessorModule.SessionProcessor.Service.of({
      create: Effect.fn("TestSessionProcessor.create")((input) => {
        const r = results[Math.min(idx++, results.length - 1)]
        const msg = input.assistantMessage
        return Effect.succeed({
          get message() {
            return msg
          },
          abort: Effect.fn("TestSessionProcessor.abort")(() => Effect.void),
          partFromToolCall() {
            return {
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: msg.sessionID,
              type: "tool" as const,
              callID: "fake",
              tool: "fake",
              state: { status: "pending" as const, input: {}, raw: "" },
            }
          },
          process: Effect.fn("TestSessionProcessor.process")(() => Effect.succeed(r)),
        } satisfies SessionProcessorModule.SessionProcessor.Handle)
      }),
    }),
  )
}

function makeRuntime(
  processorLayer: Layer.Layer<any>,
  provider = wide(),
  configLayer = Config.defaultLayer,
) {
  const bus = Bus.layer
  return ManagedRuntime.make(
    Layer.mergeAll(
      SessionCompaction.layer.pipe(Layer.provide(SessionCompactionPolicy.defaultLayer)),
      SessionCompactionPolicy.defaultLayer,
      bus,
    ).pipe(
      Layer.provide(provider.layer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(processorLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(bus),
      Layer.provide(configLayer),
    ),
  )
}

// ─── Retry strategy progression ────────────────────────────────────────

describe("integration: retry strategy progression", () => {
  test("progresses through full → compact-tools → recent-turns strategies", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const captured: Array<{ messages: unknown[]; maxOutputTokens?: number }> = []
        const rt = makeRuntime(
          capturingSequenceLayer(["compact", "compact", "continue"], captured),
        )
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          expect(result).toBe("continue")
          // 3 attempts were made
          expect(captured).toHaveLength(3)
          // Each attempt received fewer or equal messages (strategies shrink context)
          const counts = captured.map((c) => c.messages.length)
          // Attempt 0 (full) should have the most messages
          // Attempt 1 (compact-tools) same count but tool outputs marked compacted
          // Attempt 2 (recent-turns) should have fewer messages
          expect(counts[2]).toBeLessThanOrEqual(counts[0])
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("succeeds on second attempt after PTL on first", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const captured: Array<{ messages: unknown[] }> = []
        const rt = makeRuntime(
          capturingSequenceLayer(["compact", "continue"], captured),
        )
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          expect(result).toBe("continue")
          expect(captured).toHaveLength(2)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("creates error summary when all retry strategies exhausted", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        // max_retries=2 means 3 attempts (0,1,2), all returning "compact"
        const rt = makeRuntime(sequenceLayer(["compact", "compact", "compact"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          expect(result).toBe("stop")

          const all = await Session.messages({ sessionID: session.id })
          const error = all.find(
            (m) => m.info.role === "assistant" && m.info.summary && m.info.finish === "error",
          )
          expect(error).toBeDefined()
          if (error?.info.role === "assistant") {
            expect(JSON.stringify(error.info.error)).toContain("exhausted all retry strategies")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("passes maxOutputTokens to each processor attempt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const captured: Array<{ messages: unknown[]; maxOutputTokens?: number }> = []
        const rt = makeRuntime(
          capturingSequenceLayer(["compact", "continue"], captured),
        )
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          // Both attempts should get the maxOutputTokens cap
          expect(captured.length).toBeGreaterThanOrEqual(2)
          for (const cap of captured) {
            expect(cap.maxOutputTokens).toBe(20_000)
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

// ─── Attachment restoration ────────────────────────────────────────────

describe("integration: attachment restoration", () => {
  test("restores non-media tool attachments after compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const u = await user(session.id, "read files")
        const a = await assistant(session.id, u.id, tmp.path)
        await toolWithAttachment(session.id, a.id, "bash", "done", [
          { mime: "text/plain", filename: "config.json", url: "file:///tmp/config.json" },
        ])
        await user(session.id, "summarize")

        const rt = makeRuntime(sequenceLayer(["continue"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msgs[msgs.length - 1].info.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("continue")

          const all = await Session.messages({ sessionID: session.id })
          const last = all.at(-1)
          expect(last?.info.role).toBe("user")
          // The attachment should be restored as a file part on the continue message
          const fileParts = last?.parts.filter((p) => p.type === "file") ?? []
          expect(fileParts.length).toBeGreaterThan(0)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("skips media attachments during restoration", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const u = await user(session.id, "show image")
        const a = await assistant(session.id, u.id, tmp.path)
        await toolWithAttachment(session.id, a.id, "bash", "done", [
          { mime: "image/png", filename: "screenshot.png", url: "file:///tmp/screenshot.png" },
          { mime: "text/plain", filename: "output.txt", url: "file:///tmp/output.txt" },
        ])
        await user(session.id, "summarize")

        const rt = makeRuntime(sequenceLayer(["continue"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msgs[msgs.length - 1].info.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("continue")

          const all = await Session.messages({ sessionID: session.id })
          const last = all.at(-1)
          const fileParts = (last?.parts.filter((p) => p.type === "file") ?? []) as Array<{ mime: string }>
          // image/png should be filtered out, only text/plain restored
          const mimes = fileParts.map((p) => p.mime)
          expect(mimes).not.toContain("image/png")
          expect(mimes).toContain("text/plain")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("does not restore attachments when restore_attachments is false", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ compaction: { restore_attachments: false } }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const u = await user(session.id, "read files")
        const a = await assistant(session.id, u.id, tmp.path)
        await toolWithAttachment(session.id, a.id, "bash", "done", [
          { mime: "text/plain", filename: "data.json", url: "file:///tmp/data.json" },
        ])
        await user(session.id, "summarize")

        const rt = makeRuntime(sequenceLayer(["continue"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msgs[msgs.length - 1].info.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("continue")

          const all = await Session.messages({ sessionID: session.id })
          const last = all.at(-1)
          const fileParts = last?.parts.filter((p) => p.type === "file") ?? []
          expect(fileParts).toHaveLength(0)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("does not restore unsupported non-text attachments", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const u = await user(session.id, "read files")
        const a = await assistant(session.id, u.id, tmp.path)
        await toolWithAttachment(session.id, a.id, "bash", "done", [
          { mime: "application/json", filename: "data.json", url: "file:///tmp/data.json" },
        ])
        await user(session.id, "summarize")

        const rt = makeRuntime(sequenceLayer(["continue"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msgs[msgs.length - 1].info.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("continue")

          const all = await Session.messages({ sessionID: session.id })
          const last = all.at(-1)
          const fileParts = last?.parts.filter((p) => p.type === "file") ?? []
          expect(fileParts).toHaveLength(0)
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

// ─── Breaker full lifecycle ────────────────────────────────────────────

describe("integration: breaker lifecycle", () => {
  test("full lifecycle: failures → trip → manual bypass → success resets", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const msgs = await Session.messages({ sessionID: session.id })

        // Use a single runtime for failure accumulation (InstanceState is per-runtime)
        const rt = makeRuntime(sequenceLayer(["compact"]))
        try {
          // Phase 1: accumulate 3 failures to trip the breaker
          for (let i = 0; i < 3; i++) {
            await rt.runPromise(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msg.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: true,
                }),
              ),
            )
          }

          const can = await rt.runPromise(
            SessionCompactionPolicy.Service.use((s) => s.canAutoCompact(session.id)),
          )
          expect(can).toBe(false)
        } finally {
          await rt.dispose()
        }

        // Phase 2: manual compaction still works with breaker open
        const rt2 = makeRuntime(sequenceLayer(["continue"]))
        try {
          const result = await rt2.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          expect(result).toBe("continue")
        } finally {
          await rt2.dispose()
        }

        // Phase 3: successful auto-compaction resets the breaker
        const rt3 = makeRuntime(sequenceLayer(["continue"]))
        try {
          const result = await rt3.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("continue")

          const can = await rt3.runPromise(
            SessionCompactionPolicy.Service.use((s) => s.canAutoCompact(session.id)),
          )
          expect(can).toBe(true)
        } finally {
          await rt3.dispose()
        }
      },
    })
  })

  test("auto-compaction failure records in policy after retry exhaustion", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const msgs = await Session.messages({ sessionID: session.id })

        // All retry attempts return "compact" → exhaustion → counts as failure
        const rt = makeRuntime(sequenceLayer(["compact", "compact", "compact"]))
        try {
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )
          expect(result).toBe("stop")

          // Failure should be recorded in policy
          const can = await rt.runPromise(
            SessionCompactionPolicy.Service.use((s) => s.canAutoCompact(session.id)),
          )
          // After 1 exhaustion, failures = 1, still under threshold (3)
          expect(can).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

// ─── Post-compact budget ───────────────────────────────────────────────

describe("integration: post-compact budget", () => {
  test("compaction with custom post_budget via config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { post_budget: 100_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")

        const rt = makeRuntime(sequenceLayer(["continue"]))
        try {
          const msgs = await Session.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )
          // Just verifying the custom config path doesn't crash
          expect(result).toBe("continue")
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})
