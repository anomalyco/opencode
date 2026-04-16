import path from "path"
import { describe, expect, test } from "bun:test"
import { NamedError } from "@opencode-ai/shared/util/error"
import { fileURLToPath } from "url"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionPrompt.Service | Session.Service>) {
  return Effect.runPromise(
    fx.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer))),
  )
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function chat(text: string) {
  const payload =
    [
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { role: "assistant" } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: text } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(payload))
      ctrl.close()
    },
  })
}

function hanging(ready: () => void) {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setTimeout> | undefined
  const first = `data: ${JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    choices: [{ delta: { role: "assistant" } }],
  })}\n\n`
  const rest =
    [
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "late" } }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n"

  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(first))
      ready()
      timer = setTimeout(() => {
        ctrl.enqueue(encoder.encode(rest))
        ctrl.close()
      }, 10000)
    },
    cancel() {
      if (timer) clearTimeout(timer)
    },
  })
}

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})

            const missing = path.join(tmp.path, "does-not-exist.ts")
            const msg = yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              noReply: true,
              parts: [
                { type: "text", text: "please review @does-not-exist.ts" },
                {
                  type: "file",
                  mime: "text/plain",
                  url: `file://${missing}`,
                  filename: "does-not-exist.ts",
                },
              ],
            })

            if (msg.info.role !== "user") throw new Error("expected user message")

            const hasFailure = msg.parts.some(
              (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
            )
            expect(hasFailure).toBe(true)

            yield* sessions.remove(session.id)
          }),
        ),
    })
  })

  test("keeps stored part order stable when file resolution is async", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})

            const missing = path.join(tmp.path, "still-missing.ts")
            const msg = yield* prompt.prompt({
              sessionID: session.id,
              agent: "build",
              noReply: true,
              parts: [
                {
                  type: "file",
                  mime: "text/plain",
                  url: `file://${missing}`,
                  filename: "still-missing.ts",
                },
                { type: "text", text: "after-file" },
              ],
            })

            if (msg.info.role !== "user") throw new Error("expected user message")

            const stored = MessageV2.get({
              sessionID: session.id,
              messageID: msg.info.id,
            })
            const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

            expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
            expect(text[1]?.includes("Read tool failed to read")).toBe(true)
            expect(text[2]).toBe("after-file")

            yield* sessions.remove(session.id)
          }),
        ),
    })
  })
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})
            const template = "Read @file#name.txt"
            const parts = yield* prompt.resolvePromptParts(template)
            const fileParts = parts.filter((part) => part.type === "file")

            expect(fileParts.length).toBe(1)
            expect(fileParts[0].filename).toBe("file#name.txt")
            expect(fileParts[0].url).toContain("%23")

            const decodedPath = fileURLToPath(fileParts[0].url)
            expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

            const message = yield* prompt.prompt({
              sessionID: session.id,
              parts,
              noReply: true,
            })
            const stored = MessageV2.get({ sessionID: session.id, messageID: message.info.id })
            const textParts = stored.parts.filter((part) => part.type === "text")
            const hasContent = textParts.some((part) => part.text.includes("special content"))
            expect(hasContent).toBe(true)

            yield* sessions.remove(session.id)
          }),
        ),
    })
  })
})

describe("session.prompt regression", () => {
  test("does not loop empty assistant turns for a simple reply", async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }
        calls++
        return new Response(chat("packages/opencode/src/session/processor.ts"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              enabled_providers: ["alibaba"],
              provider: {
                alibaba: {
                  options: {
                    apiKey: "test-key",
                    baseURL: `${server.url.origin}/v1`,
                  },
                },
              },
              agent: {
                build: {
                  model: "alibaba/qwen-plus",
                },
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service
              const sessions = yield* Session.Service
              const session = yield* sessions.create({ title: "Prompt regression" })
              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                parts: [{ type: "text", text: "Where is SessionProcessor?" }],
              })

              expect(result.info.role).toBe("assistant")
              expect(result.parts.some((part) => part.type === "text" && part.text.includes("processor.ts"))).toBe(true)

              const msgs = yield* sessions.messages({ sessionID: session.id })
              expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
              expect(calls).toBe(1)
            }),
          ),
      })
    } finally {
      server.stop(true)
    }
  })

  test("records aborted errors when prompt is cancelled mid-stream", async () => {
    const ready = defer<void>()
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) {
          return new Response("not found", { status: 404 })
        }
        return new Response(
          hanging(() => ready.resolve()),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        )
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              enabled_providers: ["alibaba"],
              provider: {
                alibaba: {
                  options: {
                    apiKey: "test-key",
                    baseURL: `${server.url.origin}/v1`,
                  },
                },
              },
              agent: {
                build: {
                  model: "alibaba/qwen-plus",
                },
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service
              const sessions = yield* Session.Service
              const session = yield* sessions.create({ title: "Prompt cancel regression" })
              const task = Effect.runPromise(
                prompt.prompt({
                  sessionID: session.id,
                  agent: "build",
                  parts: [{ type: "text", text: "Cancel me" }],
                }),
              )

              yield* Effect.promise(() => ready.promise)
              yield* prompt.cancel(session.id)

              const result = yield* Effect.promise(() =>
                Promise.race([
                  task,
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("timed out waiting for cancel")), 1000),
                  ),
                ]),
              )

              expect(result.info.role).toBe("assistant")
              if (result.info.role === "assistant") {
                expect(result.info.error?.name).toBe("MessageAbortedError")
              }

              const msgs = yield* sessions.messages({ sessionID: session.id })
              const last = msgs.findLast((msg) => msg.info.role === "assistant")
              expect(last?.info.role).toBe("assistant")
              if (last?.info.role === "assistant") {
                expect(last.info.error?.name).toBe("MessageAbortedError")
              }
            }),
          ),
      })
    } finally {
      server.stop(true)
    }
  })
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service
              const sessions = yield* Session.Service
              const session = yield* sessions.create({})

              const other = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                model: { providerID: ProviderID.make("opencode"), modelID: ModelID.make("kimi-k2.5-free") },
                noReply: true,
                parts: [{ type: "text", text: "hello" }],
              })
              if (other.info.role !== "user") throw new Error("expected user message")
              expect(other.info.model.variant).toBeUndefined()

              const match = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                parts: [{ type: "text", text: "hello again" }],
              })
              if (match.info.role !== "user") throw new Error("expected user message")
              expect(match.info.model).toEqual({
                providerID: ProviderID.make("openai"),
                modelID: ModelID.make("gpt-5.2"),
                variant: "xhigh",
              })
              expect(match.info.model.variant).toBe("xhigh")

              const override = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                noReply: true,
                variant: "high",
                parts: [{ type: "text", text: "hello third" }],
              })
              if (override.info.role !== "user") throw new Error("expected user message")
              expect(override.info.model.variant).toBe("high")

              yield* sessions.remove(session.id)
            }),
          ),
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})

describe("session.agent-resolution", () => {
  test("unknown agent throws typed error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})
            const err = yield* Effect.promise(() =>
              Effect.runPromise(
                prompt.prompt({
                  sessionID: session.id,
                  agent: "nonexistent-agent-xyz",
                  noReply: true,
                  parts: [{ type: "text", text: "hello" }],
                }),
              ).then(
                () => undefined,
                (e) => e,
              ),
            )
            expect(err).toBeDefined()
            expect(err).not.toBeInstanceOf(TypeError)
            expect(NamedError.Unknown.isInstance(err)).toBe(true)
            if (NamedError.Unknown.isInstance(err)) {
              expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
            }
          }),
        ),
    })
  }, 30000)

  test("unknown agent error includes available agent names", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})
            const err = yield* Effect.promise(() =>
              Effect.runPromise(
                prompt.prompt({
                  sessionID: session.id,
                  agent: "nonexistent-agent-xyz",
                  noReply: true,
                  parts: [{ type: "text", text: "hello" }],
                }),
              ).then(
                () => undefined,
                (e) => e,
              ),
            )
            expect(NamedError.Unknown.isInstance(err)).toBe(true)
            if (NamedError.Unknown.isInstance(err)) {
              expect(err.data.message).toContain("build")
            }
          }),
        ),
    })
  }, 30000)

  test("unknown command throws typed error with available names", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        run(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})
            const err = yield* Effect.promise(() =>
              Effect.runPromise(
                prompt.command({
                  sessionID: session.id,
                  command: "nonexistent-command-xyz",
                  arguments: "",
                }),
              ).then(
                () => undefined,
                (e) => e,
              ),
            )
            expect(err).toBeDefined()
            expect(err).not.toBeInstanceOf(TypeError)
            expect(NamedError.Unknown.isInstance(err)).toBe(true)
            if (NamedError.Unknown.isInstance(err)) {
              expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
              expect(err.data.message).toContain("init")
            }
          }),
        ),
    })
  }, 30000)
})
