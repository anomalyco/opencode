import { afterEach, expect, jest, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { IpcClient } from "../sdk"
import { createConnection } from "./connection"
import type { BrowserPane, PaneEvent } from "./ipc"

type Input = Parameters<typeof createConnection>[0]

type State = Parameters<Input["change"]>[0]

type Client = IpcClient<(typeof BrowserPane)["spec"]>

/** The pane's Ipc as a test drives it: whether it is available, and the error its register rejects with. */
type IpcStub = { available: boolean; reject?: Error }

/** The strip's owner: whether the session's location is known, and the mirror it holds until it is. */
type StripOwner = { located: boolean; held?: () => void }

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

const browser: Browser.State = {
  tabs: [
    {
      id: tabID,
      url: "http://localhost:4173/",
      title: "Preview",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      generation: 3,
    },
  ],
  focusedTabID: tabID,
}

afterEach(() => {
  jest.useRealTimers()
})

// The client stands in for the pane's main entry: each register is one binding with its own events.
// `strip` stands in for the browser tab IDs the session's layout stores. While `owner.located` is false the strip
// cannot be written, so the owner holds the latest mirror, as the model does until the session's location loads.
function fixture(strip: string[] = []) {
  const states: State[] = []
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const calls: { input: Parameters<Client["register"]>[0]; commands: Browser.Action[] }[] = []
  const closed: string[] = []
  const highlights: { binding: string; tabID: Browser.TabID; ref?: Browser.Ref }[] = []

  const routed: Record<"preview" | "inspect" | "focus", unknown[]> = {
    preview: [],
    inspect: [],
    focus: [],
  }

  const target = { server: "browser-test", session: "ses_browser" }
  // The Ipc is gone while the pane's main extension reloads or is disabled.
  // An endpoint main cannot resolve, e.g. an SSH server's while it reconnects, makes register reject.
  const ipc: IpcStub = { available: true }
  const owner: StripOwner = { located: true }

  const client: Client = {
    register: async (input) => {
      calls.push({ input, commands: [] })

      if (ipc.reject) throw ipc.reject
    },
    load: async () => undefined,
    command: async (input) => {
      calls.find((call) => call.input.binding === input.binding)?.commands.push(input.command)
    },
    inspect: async () => undefined,
    highlight: async (input) => {
      highlights.push(input)
    },
    zoom: async () => undefined,
    site: async () => ({ cookies: 0 }),
    clearSite: async () => undefined,
    close: async (input) => {
      closed.push(input.binding)
    },
    state: () => undefined,
    on: () => () => undefined,
  }

  const connection = createConnection({
    client: () => (ipc.available ? client : undefined),
    listen(binding, listener) {
      listeners.set(binding, listener)

      return () => listeners.delete(binding)
    },
    target: () => ({ ...target }),
    change: (state, mirror) => {
      states.push(state)

      if (owner.located) return mirror()
      owner.held = mirror
    },
    strip: {
      stored: () => strip,
      open: (id) => {
        if (!strip.includes(id)) strip.push(id)
      },
      close: (id) => {
        if (strip.includes(id)) strip.splice(strip.indexOf(id), 1)
      },
    },
    focus: (tabID) => routed.focus.push(tabID),
    preview: (path) => routed.preview.push(path),
    inspect: (event) => routed.inspect.push(event),
    page: () => undefined,
    address: () => undefined,
  })

  const emit = (index: number, event: PaneEvent) => listeners.get(calls[index].input.binding)?.(event)
  connection.wake()
  emit(0, { type: "state", state: browser })

  return { connection, calls, states, target, ipc, owner, routed, highlights, closed, listeners, emit, strip }
}

const element = {
  ref: Browser.Ref.make("e4"),
  selector: "#save",
  label: "button#save",
  rect: { x: 1, y: 2, width: 3, height: 4 },
}

test.each([
  { route: "preview" as const, event: { type: "preview", path: "docs/report.pdf" } as const, value: "docs/report.pdf" },
  { route: "focus" as const, event: { type: "focus", tabID } as const, value: tabID },
  {
    route: "inspect" as const,
    event: { type: "inspect", tabID, active: false, element } as const,
    value: { type: "inspect", tabID, active: false, element },
  },
])("$route events reach the session without touching connection state", ({ route, event, value }) => {
  const app = fixture()

  try {
    const before = app.states.length
    app.emit(0, event)
    expect(app.routed[route]).toEqual([value])
    expect(app.states).toHaveLength(before)
  } finally {
    app.connection.dispose()
  }
})

test("highlights of picked elements reach the page", async () => {
  const app = fixture()

  try {
    app.connection.highlight(tabID, element.ref)
    app.connection.highlight(tabID)
    await Bun.sleep(0)
    const binding = app.calls[0].input.binding
    expect(app.highlights).toEqual([
      { binding, tabID, ref: element.ref },
      { binding, tabID },
    ])
  } finally {
    app.connection.dispose()
  }
})

test("suspension retains tabs and reconnects once on demand using the current target", () => {
  jest.useFakeTimers()
  const app = fixture()

  try {
    const stale = app.listeners.get(app.calls[0].input.binding)!
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    expect(app.listeners.has(app.calls[0].input.binding)).toBe(false)
    expect(app.states.at(-1)).toMatchObject({ registration: undefined, browser, suspended: true })
    // A suspended attachment must not schedule the transport retry.
    jest.advanceTimersByTime(30_000)
    expect(app.calls).toHaveLength(1)
    app.target.server = "browser-moved"
    app.connection.wake()
    app.connection.wake()
    expect(app.calls).toHaveLength(2)
    expect(app.calls[1].input).toEqual({
      binding: expect.any(String),
      server: "browser-moved",
      session: "ses_browser",
      restore: browser,
    })
    expect(app.states.at(-1)?.suspended).toBe(false)
    // A late event from the suspended binding must not close the new one.
    stale({ type: "state", state: null, error: "browser.pane.registration.closed" })
    expect(app.states.at(-1)?.registration).toBeDefined()
  } finally {
    app.connection.dispose()
  }
})

test("a registration lost with the pane's Ipc registers again with its tabs once the Ipc is back", () => {
  const app = fixture()

  try {
    app.emit(0, { type: "embed", tabID, embed: "embed-1" })
    expect(app.states.at(-1)?.embeds).toEqual({ [tabID]: "embed-1" })
    app.ipc.available = false
    app.connection.refresh()
    expect(app.listeners.has(app.calls[0].input.binding)).toBe(false)
    expect(app.states.at(-1)).toMatchObject({ registration: undefined, embeds: {}, browser, suspended: true })
    app.ipc.available = true
    app.connection.refresh()
    app.connection.refresh()
    expect(app.calls).toHaveLength(2)
    expect(app.calls[1].input).toEqual({
      binding: expect.any(String),
      server: "browser-test",
      session: "ses_browser",
      restore: browser,
    })
  } finally {
    app.connection.dispose()
  }
})

test("only a native inventory, the first one included, closes stored tabs the desktop lacks", () => {
  const stale = `tab_${crypto.randomUUID()}`
  const app = fixture([tabID, stale])

  try {
    expect(app.strip).toEqual([tabID])
    // Suspended, restoring, and unavailable states keep a stored tab until the desktop answers.
    app.strip.push(stale)
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    app.connection.wake()
    app.ipc.available = false
    app.connection.refresh()
    expect(app.strip).toEqual([tabID, stale])
    app.ipc.available = true
    app.connection.refresh()
    app.emit(2, { type: "state", state: browser })
    expect(app.strip).toEqual([tabID])
  } finally {
    app.connection.dispose()
  }
})

test("a mirror held while the strip cannot be written still adds new tabs and prunes once it lands", () => {
  const added = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
  const stale = `tab_${crypto.randomUUID()}`
  const app = fixture()

  try {
    app.owner.located = false
    app.strip.push(stale)
    app.emit(0, { type: "state", state: { ...browser, tabs: [...browser.tabs, { ...browser.tabs[0], id: added }] } })
    // A later report replaces the held mirror before the strip can be written.
    app.emit(0, { type: "embed", tabID: added, embed: "embed-2" })
    expect(app.strip).toEqual([tabID, stale])
    app.owner.located = true
    app.owner.held?.()
    expect(app.strip).toEqual([tabID, added])
  } finally {
    app.connection.dispose()
  }
})

test("a rejected registration clears itself and retries with its tabs after the backoff", async () => {
  jest.useFakeTimers()
  const app = fixture()

  try {
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    app.ipc.reject = new Error("browser.pane.registration.invalid")
    await expect(app.connection.command({ type: "reload", tabID })).rejects.toThrow("browser.pane.registration.invalid")
    expect(app.listeners.has(app.calls[1].input.binding)).toBe(false)
    expect(app.states.at(-1)).toMatchObject({ registration: undefined, embeds: {}, browser, suspended: false })
    app.ipc.reject = undefined
    jest.advanceTimersByTime(999)
    expect(app.calls).toHaveLength(2)
    jest.advanceTimersByTime(1)
    expect(app.calls).toHaveLength(3)
    expect(app.calls[2].input).toEqual({
      binding: expect.any(String),
      server: "browser-test",
      session: "ses_browser",
      restore: browser,
    })
    // Let the new registration settle: a replayed command would reach it now.
    jest.useRealTimers()
    await Bun.sleep(0)
    expect(app.calls.map((call) => call.commands)).toEqual([[], [], []])
  } finally {
    app.connection.dispose()
  }
})

test("a command wakes its attachment once and is not replayed", async () => {
  const app = fixture()

  try {
    app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
    await app.connection.command({ type: "reload", tabID })
    expect(app.calls).toHaveLength(2)
    expect(app.calls[1].commands).toEqual([{ type: "reload", tabID }])
    app.connection.dispose()
    app.connection.wake()
    await Bun.sleep(0)
    expect(app.closed).toEqual([app.calls[0].input.binding, app.calls[1].input.binding])
    expect(app.calls).toHaveLength(2)
  } finally {
    app.connection.dispose()
  }
})

// Main rejects the register of a binding it closes, and that reply can overtake the closed-state event.
test.each([
  { error: "browser.pane.replaced", rejected: false },
  { error: "browser.pane.unsupported", rejected: false },
  { error: "browser.pane.replaced", rejected: true },
  { error: "browser.pane.unsupported", rejected: true },
])("$error blocks automatic ownership recovery (register rejected first: $rejected)", async ({ error, rejected }) => {
  jest.useFakeTimers()
  const app = fixture()

  try {
    if (rejected) {
      app.emit(0, { type: "state", state: browser, error: "browser.pane.suspended" })
      app.ipc.reject = new Error("browser.pane.registration.closed")
      app.connection.wake()
      await Promise.resolve()
    }

    app.emit(app.calls.length - 1, { type: "state", state: null, error })
    jest.advanceTimersByTime(30_000)
    app.connection.wake()
    expect(app.calls).toHaveLength(rejected ? 2 : 1)
    expect(app.states.at(-1)?.error).toBe(error)
  } finally {
    app.connection.dispose()
  }
})
