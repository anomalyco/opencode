import { afterEach, describe, expect, mock, test } from "bun:test"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Auth } from "@opencode-ai/sdk"
import { CopilotAuthPlugin } from "../../src/plugin/github-copilot/copilot"

type ChatInput = Parameters<NonNullable<Hooks["chat.headers"]>>[0]
type ChatOutput = Parameters<NonNullable<Hooks["chat.headers"]>>[1]
type Loader = NonNullable<NonNullable<Hooks["auth"]>["loader"]>

const originalFetch = globalThis.fetch

function model() {
  return {
    providerID: "github-copilot",
    api: {
      npm: "@ai-sdk/github-copilot",
    },
  } as ChatInput["model"]
}

function incoming(input?: Partial<ChatInput>): ChatInput {
  return {
    sessionID: "session",
    agent: "build",
    model: model(),
    provider: {} as ChatInput["provider"],
    message: {
      id: "message",
      sessionID: "session",
    } as ChatInput["message"],
    ...input,
  }
}

async function plugin(input?: { message?: () => Promise<unknown>; session?: () => Promise<unknown> }) {
  const client = {
    session: {
      message: mock(input?.message ?? (() => Promise.resolve({ data: { parts: [] } }))),
      get: mock(input?.session ?? (() => Promise.resolve({ data: { id: "session" } }))),
    },
  }

  const hooks = await CopilotAuthPlugin({
    client: client as unknown as PluginInput["client"],
    directory: "/tmp",
    project: {} as PluginInput["project"],
    worktree: "/tmp",
    serverUrl: new URL("http://localhost:4096"),
    $: Bun.$,
  })

  return { hooks, client }
}

function headers(init?: RequestInit) {
  if (!init?.headers) return {}
  if (init.headers instanceof Headers) return Object.fromEntries(init.headers.entries())
  if (Array.isArray(init.headers)) return Object.fromEntries(init.headers)
  return init.headers as Record<string, string>
}

async function oauth() {
  const { hooks } = await plugin()
  const loader = hooks.auth?.loader
  if (!loader) throw new Error("Missing auth loader")
  return loader(
    () =>
      Promise.resolve({
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: 0,
      } satisfies Auth),
    {} as Parameters<Loader>[1],
  )
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("plugin.github-copilot", () => {
  test("marks compaction messages as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [{ type: "compaction" }],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(
      incoming({
        agent: "compaction",
      }),
      output,
    )

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not mark synthetic-only messages without compaction marker as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [
              {
                type: "text",
                synthetic: true,
                text: "Summarize the task tool output above and continue with your task.",
              },
            ],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(incoming(), output)

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("marks auto-compaction marker messages as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [
              {
                type: "text",
                text: "[auto-compaction-followup]",
                synthetic: true,
                ignored: true,
              },
              {
                type: "text",
                text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
                synthetic: true,
              },
            ],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(incoming(), output)

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not mark literal marker text from a normal user message as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [
              {
                type: "text",
                text: "[auto-compaction-followup]",
              },
            ],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(incoming(), output)

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("marks compaction trigger messages as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [
              {
                type: "compaction",
                summary: "The conversation was compacted.",
                auto: true,
              },
            ],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(incoming(), output)

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("marks AI-initiated child session as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [{ type: "text", text: "Review the code changes" }],
          },
        }),
      session: () =>
        Promise.resolve({
          data: {
            id: "child-session",
            parentID: "parent-session",
            permission: [],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(
      incoming({
        sessionID: "child-session",
        message: { id: "message", sessionID: "child-session" } as ChatInput["message"],
      }),
      output,
    )

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not mark user slash command child session as agent initiated", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [{ type: "text", text: "Review the code changes" }],
          },
        }),
      session: () =>
        Promise.resolve({
          data: {
            id: "child-session",
            parentID: "parent-session",
            permission: [{ permission: "user_slash_command", pattern: "review", action: "allow" }],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(
      incoming({
        sessionID: "child-session",
        message: { id: "message", sessionID: "child-session" } as ChatInput["message"],
      }),
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not override normal top-level user messages", async () => {
    const { hooks } = await plugin({
      message: () =>
        Promise.resolve({
          data: {
            parts: [{ type: "text", text: "hello" }],
          },
        }),
    })
    const output: ChatOutput = { headers: {} }

    await hooks["chat.headers"]?.(incoming(), output)

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("sets the vision header for normal image requests", async () => {
    let hdrs = {}
    globalThis.fetch = mock((_req: RequestInfo | URL, init?: RequestInit) => {
      hdrs = headers(init)
      return Promise.resolve(new Response("", { status: 200 }))
    }) as unknown as typeof fetch

    const cfg = await oauth()
    if (typeof cfg.fetch !== "function") throw new Error("Missing auth fetch")

    await cfg.fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.com/image.png" },
              },
            ],
          },
        ],
      }),
    })

    expect(hdrs).toMatchObject({
      "x-initiator": "user",
      "Copilot-Vision-Request": "true",
    })
  })

  test("keeps the vision header when x-initiator is already agent", async () => {
    let hdrs = {}
    globalThis.fetch = mock((_req: RequestInfo | URL, init?: RequestInit) => {
      hdrs = headers(init)
      return Promise.resolve(new Response("", { status: 200 }))
    }) as unknown as typeof fetch

    const cfg = await oauth()
    if (typeof cfg.fetch !== "function") throw new Error("Missing auth fetch")

    await cfg.fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "x-initiator": "agent",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.com/image.png" },
              },
            ],
          },
        ],
      }),
    })

    expect(hdrs).toMatchObject({
      "x-initiator": "agent",
      "Copilot-Vision-Request": "true",
    })
  })
})
