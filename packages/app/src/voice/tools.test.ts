import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import { parseVoiceDelegation } from "@/session/timeline/voice-delegation"
import { continuedHeader, header, headerLapse } from "./handoff"
import { VoiceTools } from "./tools"

afterEach(() => {
  setSystemTime()
})

const models = [
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    providerID: "anthropic",
    enabled: true,
    variants: [{ id: "medium" }, { id: "high" }],
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    providerID: "openai",
    enabled: true,
    variants: [{ id: "high" }, { id: "xhigh" }],
  },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", providerID: "google", enabled: true, variants: [] },
  { id: "gpt-4", name: "GPT-4", providerID: "openai", enabled: false, variants: [] },
]

const session = (id: string, title: string, extra: Partial<SessionInfo> = {}) =>
  ({
    id,
    title,
    location: { directory: `/home/alex/code/${title.toLowerCase()}` },
    time: { created: 1, updated: 1 },
    ...extra,
  }) as SessionInfo

function setup(
  input: {
    open?: (session: SessionInfo, signal: AbortSignal) => Promise<void>
    tabs?: string[]
    sessions?: SessionInfo[]
  } = {},
) {
  const sessions = [
    session("ses_here", "HERE", {
      model: { id: "claude-opus-4", providerID: "anthropic", variant: "high" },
    } as Partial<SessionInfo>),
    session("ses_desktop", "DESKTOP"),
    session("ses_old", "OLD", { time: { created: 1, updated: 1, archived: 2 } }),
    ...(input.sessions ?? []),
  ]

  const calls = {
    open: [] as string[],
    background: [] as string[],
    prompts: [] as { sessionID: string; text: string }[],
    switched: [] as unknown[],
  }

  const empty = { data: [], cursor: {} }

  const ctx = {
    sdk: {
      api: {
        session: {
          get: async (request: { sessionID: string }) => {
            const found = sessions.find((item) => item.id === request.sessionID)

            if (!found) throw new Error("not found")

            return found
          },
          // Newest first, one page, like the server.
          list: async (request: { search?: string; parentID?: null; limit?: number }) => ({
            data: sessions
              .filter(
                (item) =>
                  !item.time.archived &&
                  (request.parentID !== null || !item.parentID) &&
                  (!request.search || item.title?.toLowerCase().includes(request.search.toLowerCase())),
              )
              .toSorted((a, b) => b.time.updated - a.time.updated)
              .slice(0, request.limit),
            cursor: {},
          }),
          switchModel: async (request: unknown) => calls.switched.push(request),
          background: async (request: { sessionID: string }) => calls.background.push(request.sessionID),
          inbox: { list: async () => [] },
        },
        message: { list: async () => empty },
        model: { list: async () => ({ data: models }) },
      },
    },
    data: {
      session: {
        prompt: async (request: { sessionID: string; text: string }) => calls.prompts.push(request),
      },
    },
  } as unknown as ServerCtx

  const tools = new VoiceTools(ctx, {
    open: async (next, signal) => {
      calls.open.push(next.id)
      await input.open?.(next, signal)
    },
    tabs: () => input.tabs ?? [],
  })

  const request = { id: "delegation", sessionID: "ses_here", transcript: ["user: go to the desktop session"] }
  let count = 0

  const run = async (name: string, args: Record<string, unknown> = {}, signal = new AbortController().signal) =>
    JSON.parse(await tools.run({ call_id: `call_${count++}`, name, arguments: JSON.stringify(args) }, request, signal))

  return { calls, request, run }
}

describe("open_session", () => {
  test("opens the session and later tools default to it", async () => {
    const voice = setup()

    expect(await voice.run("open_session", { session_id: "ses_desktop" })).toEqual({ opened: "DESKTOP" })
    expect(voice.calls.open).toEqual(["ses_desktop"])
    expect(voice.request.sessionID).toBe("ses_desktop")
  })

  test("reports a missing or archived session without moving the screen", async () => {
    const voice = setup()

    expect((await voice.run("open_session", { session_id: "ses_missing" })).error).toContain("did not move")
    expect((await voice.run("open_session", { session_id: "ses_old" })).error).toContain("archived")
    expect(voice.calls.open).toEqual([])
    expect(voice.request.sessionID).toBe("ses_here")
  })

  test("passes the tool's abort signal to the screen", async () => {
    const signals: AbortSignal[] = []
    const voice = setup({ open: async (_, signal) => void signals.push(signal) })
    const abort = new AbortController()

    await voice.run("open_session", { session_id: "ses_desktop" }, abort.signal)

    expect(signals).toEqual([abort.signal])
  })

  test("reports failure when Desktop never shows the session", async () => {
    const voice = setup({ open: () => Promise.reject(new Error("not shown")) })
    const result = await voice.run("open_session", { session_id: "ses_desktop" })

    expect(result.opened).toBeUndefined()
    expect(result.error).toContain("did not move")
    expect(voice.request.sessionID).toBe("ses_here")
  })
})

describe("search_sessions", () => {
  test("ranks the spoken name first, then top-level sessions with an open tab", async () => {
    const voice = setup({
      tabs: ["ses_hex_tab"],
      sessions: [
        session("ses_hex_sub", "Hex notes", { parentID: "ses_here", time: { created: 1, updated: 9 } }),
        session("ses_hex_new", "Hex notes", { time: { created: 1, updated: 5 } }),
        session("ses_hex_tab", "Hex notes", { time: { created: 1, updated: 2 } }),
        session("ses_hex", "HEX"),
      ],
    })

    const found = await voice.run("search_sessions", { query: "the hex session" })

    expect(found.map((row: { id: string }) => row.id)).toEqual(["ses_hex", "ses_hex_tab", "ses_hex_new", "ses_hex_sub"])
    expect(found[1].open_tab).toBe(true)
  })

  test("finds an old root session behind a page of matching subagents", async () => {
    const voice = setup({
      sessions: [
        ...Array.from({ length: 100 }, (_, index) =>
          session(`ses_recent_${index}`, `Recent ${index}`, { time: { created: 1, updated: 200 + index } }),
        ),
        ...Array.from({ length: 25 }, (_, index) =>
          session(`ses_child_${index}`, `Hex probe ${index}`, {
            parentID: "ses_here",
            time: { created: 1, updated: 100 + index },
          }),
        ),
        session("ses_hex", "HEX", { time: { created: 1, updated: 0 } }),
      ],
    })

    const found = await voice.run("search_sessions", { query: "hex" })

    expect(found[0].id).toBe("ses_hex")
  })

  test("retries with the longest word when only subagents match the phrase", async () => {
    const voice = setup({
      sessions: [
        ...Array.from({ length: 100 }, (_, index) =>
          session(`ses_recent_${index}`, `Recent ${index}`, { time: { created: 1, updated: 200 + index } }),
        ),
        session("ses_child", "Kindle import probe", { parentID: "ses_here", time: { created: 1, updated: 100 } }),
        session("ses_kindle", "Kindle agent", { time: { created: 1, updated: 0 } }),
      ],
    })

    const found = await voice.run("search_sessions", { query: "kindle import" })

    expect(found.map((row: { id: string }) => row.id)).toContain("ses_kindle")
  })
})

describe("models", () => {
  test("list_models matches enabled models and marks the current one", async () => {
    const voice = setup()

    const gpt = await voice.run("list_models", { query: "gpt" })
    expect(gpt.models.map((model: { id: string }) => model.id)).toEqual(["openai/gpt-5"])

    const all = await voice.run("list_models")
    expect(all.matches).toBe(3)
    expect(all.models[0]).toEqual({
      id: "anthropic/claude-opus-4",
      name: "Claude Opus 4",
      provider: "anthropic",
      variants: ["medium", "high"],
      current: true,
      current_variant: "high",
    })
  })

  test("switch_model keeps a variant the new model offers and drops one it doesn't", async () => {
    const voice = setup()

    expect(await voice.run("switch_model", { model: "openai/gpt-5" })).toEqual({
      switched_to: "GPT-5",
      variant: "high",
      session: "HERE",
    })
    expect((await voice.run("switch_model", { model: "google/gemini-2.5-pro" })).variant).toBe("default")
    expect(voice.calls.switched).toEqual([
      { sessionID: "ses_here", model: { id: "gpt-5", providerID: "openai", variant: "high" } },
      { sessionID: "ses_here", model: { id: "gemini-2.5-pro", providerID: "google", variant: undefined } },
    ])
  })

  test("switch_model refuses an unknown or disabled model and an unknown variant", async () => {
    const voice = setup()

    expect((await voice.run("switch_model", { model: "openai/gpt-9" })).error).toContain("did not change")
    expect((await voice.run("switch_model", { model: "openai/gpt-4" })).error).toContain("did not change")
    expect((await voice.run("switch_model", { model: "openai/gpt-5", variant: "ultra" })).error).toContain(
      "high, xhigh",
    )
    expect(voice.calls.switched).toEqual([])
  })
})

describe("reading and messaging another session", () => {
  test("never moves the screen", async () => {
    const voice = setup()

    await voice.run("read_session", { session_id: "ses_desktop" })
    await voice.run("send_message", { session_id: "ses_desktop", text: "Run the tests." })

    expect(voice.calls.open).toEqual([])
    expect(voice.request.sessionID).toBe("ses_here")
  })
})

describe("send_message", () => {
  test("hands off in the iOS format, explaining the fields once per session", async () => {
    const voice = setup()

    expect((await voice.run("send_message", { session_id: "ses_desktop", text: "Run the tests." })).admitted).toBe(true)
    await voice.run("send_message", { session_id: "ses_desktop", text: "Also lint." })
    await voice.run("send_message", { text: "Check the build." })

    const [first, second, other] = voice.calls.prompts

    expect(first.text.startsWith(`${header}\n`)).toBe(true)
    expect(JSON.parse(first.text.slice(first.text.indexOf("\n") + 1))).toEqual({
      context: 'Session "DESKTOP" in project "desktop".',
      instruction: "Run the tests.",
      transcript_delta: ["user: go to the desktop session"],
    })
    expect(parseVoiceDelegation(first.text)).toEqual({ instruction: "Run the tests.", framing: undefined })
    expect(second.text.startsWith(`${continuedHeader}\n`)).toBe(true)
    expect(other.sessionID).toBe("ses_here")
    expect(other.text.startsWith(`${header}\n`)).toBe(true)
  })

  test("explains the fields again after the header lapse", async () => {
    const voice = setup()
    setSystemTime(new Date(1_000_000))

    await voice.run("send_message", { text: "One." })
    setSystemTime(new Date(1_000_000 + headerLapse - 1))
    await voice.run("send_message", { text: "Two." })
    setSystemTime(new Date(1_000_000 + 2 * headerLapse))
    await voice.run("send_message", { text: "Three." })

    expect(voice.calls.prompts.map((prompt) => prompt.text.slice(0, prompt.text.indexOf("\n")))).toEqual([
      header,
      continuedHeader,
      header,
    ])
  })

  test("moves running work to the background before a steer, not before a queued message", async () => {
    const voice = setup()

    await voice.run("send_message", { text: "Stop and look at this." })
    await voice.run("send_message", { text: "Afterwards, lint.", delivery: "queue" })

    expect(voice.calls.background).toEqual(["ses_here"])
  })
})
