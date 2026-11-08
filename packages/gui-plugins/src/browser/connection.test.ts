import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { IpcClient } from "@opencode/plugin/gui"
import { openBinding } from "./connection"
import type { BrowserPane, PaneEvent } from "./ipc"

type Client = IpcClient<(typeof BrowserPane)["spec"]>

const tabID = Browser.TabID.make("tab_aaaaaaaa-1111-1111-1111-111111111111")

const element = Browser.Ref.make("e4")

// The client stands in for the pane's main entry; `reject` is the error its register rejects with.
function fixture(reject?: Error) {
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const registered: Parameters<Client["register"]>[0][] = []
  const closed: string[] = []
  const highlights: Parameters<Client["highlight"]>[0][] = []
  const outcomes: string[] = []
  const events: PaneEvent[] = []

  const client: Client = {
    register: async (input) => {
      registered.push(input)

      if (reject) throw reject
    },
    load: async () => undefined,
    command: async () => undefined,
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

  const registration = openBinding({
    client,
    listen(binding, listener) {
      listeners.set(binding, listener)

      return () => listeners.delete(binding)
    },
    target: { server: "browser-test", session: "ses_browser" },
    accepted: () => outcomes.push("accepted"),
    failed: (cause) => outcomes.push(cause instanceof Error ? cause.message : "failed"),
    listener: (event) => events.push(event),
  })

  const binding = registered[0].binding
  const emit = (event: PaneEvent) => listeners.get(binding)?.(event)

  return { registration, binding, emit, listeners, closed, highlights, outcomes, events }
}

test("highlights of picked elements reach the page", async () => {
  const app = fixture()
  app.registration.highlight(tabID, element)
  app.registration.highlight(tabID)
  await Bun.sleep(0)
  expect(app.highlights).toEqual([
    { binding: app.binding, tabID, ref: element },
    { binding: app.binding, tabID },
  ])
})

test("a closed binding stops its events and answers, and closes once with main", async () => {
  const app = fixture()
  app.emit({ type: "focus", tabID })
  app.registration.close()
  app.registration.close()
  app.emit({ type: "focus", tabID })
  await Bun.sleep(0)
  expect(app.events).toEqual([{ type: "focus", tabID }])
  expect(app.listeners.has(app.binding)).toBe(false)
  expect(app.outcomes).toEqual([])
  expect(app.closed).toEqual([app.binding])
})

test("main's answer to the register reaches the owner", async () => {
  const accepted = fixture()
  const rejected = fixture(new Error("browser.pane.registration.invalid"))
  await Bun.sleep(0)
  expect(accepted.outcomes).toEqual(["accepted"])
  expect(rejected.outcomes).toEqual(["browser.pane.registration.invalid"])
})
