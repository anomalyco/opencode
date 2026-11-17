import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { createHandoffs } from "./handoff"
import type { HandoffEvent } from "./ipc"

const tab = {
  first: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
  second: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: { openExternal?: (url: string) => Promise<void>; timeoutMs?: number } = {}) {
  const opened: string[] = []
  const events: HandoffEvent[] = []
  let ids = 0

  const handoffs = createHandoffs({
    openExternal:
      options.openExternal ??
      ((url) => {
        opened.push(url)

        return Promise.resolve()
      }),
    timeoutMs: options.timeoutMs,
    createID: () => `handoff-${++ids}`,
  })

  const begin = (input: Partial<Parameters<typeof handoffs.begin>[0]> = {}) =>
    handoffs.begin({
      binding: "binding",
      tabID: tab.first,
      url: "https://github.com/settings/tokens",
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      ...input,
    })

  return { handoffs, opened, events, begin }
}

test("nothing opens until the user's Open, then the answer settles once", async () => {
  const { handoffs, opened, events, begin } = setup()

  const result = begin()
  await flush()

  expect(opened).toEqual([])
  expect(events).toEqual([
    {
      type: "handoff",
      tabID: tab.first,
      id: "handoff-1",
      host: "github.com",
      url: "https://github.com/settings/tokens",
      state: "pending",
    },
  ])

  expect(handoffs.settle("binding", "handoff-2", "open")).toBe(false)
  expect(handoffs.settle("other-binding", "handoff-1", "open")).toBe(false)
  expect(handoffs.settle("binding", "handoff-1", "open")).toBe(true)
  expect(handoffs.settle("binding", "handoff-1", "open")).toBe(true)
  await flush()

  expect(opened).toEqual(["https://github.com/settings/tokens"])
  expect(events.at(-1)).toEqual({
    type: "handoff",
    tabID: tab.first,
    id: "handoff-1",
    host: "github.com",
    url: "https://github.com/settings/tokens",
    state: "opened",
  })

  expect(handoffs.settle("binding", "handoff-1", "done")).toBe(true)
  expect(handoffs.settle("binding", "handoff-1", "done")).toBe(false)
  expect(await result).toEqual({ state: "completed", host: "github.com" })
  expect(events.at(-1)).toEqual({
    type: "handoff",
    tabID: tab.first,
    id: "handoff-1",
    host: "github.com",
    state: "completed",
  })
})

test("the user can abandon the handoff before or after opening", async () => {
  const { handoffs, opened, events, begin } = setup()

  const result = begin()
  await flush()
  handoffs.settle("binding", "handoff-1", "cancel")
  expect(await result).toEqual({ state: "cancelled", host: "github.com" })
  expect(opened).toEqual([])
  expect(events.at(-1)?.state).toBe("cancelled")

  const second = begin()
  await flush()
  handoffs.settle("binding", "handoff-2", "open")
  await flush()
  handoffs.settle("binding", "handoff-2", "cancel")
  expect(await second).toEqual({ state: "cancelled", host: "github.com" })
  expect(opened).toEqual(["https://github.com/settings/tokens"])
})

test("a handoff nobody answers times out and frees the pane", async () => {
  const { opened, events, begin } = setup({ timeoutMs: 5 })

  const result = begin()
  expect(await result).toEqual({ state: "timedOut", host: "github.com" })
  expect(opened).toEqual([])
  expect(events.map((event) => event.state)).toEqual(["pending", "timedOut"])
})

test("cancelling the browser request ends a waiting handoff", async () => {
  const abort = new AbortController()
  const { opened, events, begin } = setup()

  const result = begin({ signal: abort.signal })
  await flush()
  abort.abort()
  expect(await result).toEqual({ state: "cancelled", host: "github.com" })
  expect(opened).toEqual([])
  expect(events.at(-1)?.state).toBe("cancelled")
})

test("one pane waits on one handoff at a time", async () => {
  const { handoffs, opened, begin } = setup()

  const first = begin()
  await flush()
  expect(() => begin()).toThrow("A handoff is already waiting")
  expect(() => begin({ tabID: tab.second })).toThrow("A handoff is already waiting")
  expect(opened).toEqual([])

  handoffs.settle("binding", "handoff-1", "cancel")
  await first
})

test("only web pages without embedded credentials can move to the system browser", async () => {
  const { opened, begin } = setup()

  for (const url of ["file:///tmp/secret.txt", "about:blank", "https://user:pass@github.com/", "not a url"]) {
    await expect(begin({ url })).rejects.toThrow()
  }

  expect(opened).toEqual([])
})

test("a launch the user started but the system refused never echoes the URL", async () => {
  const { handoffs, events, begin } = setup({
    openExternal: () => Promise.reject(new Error("LSOpenURLsWithRole() failed for https://github.com/settings/tokens")),
  })

  const result = begin()
  await flush()
  handoffs.settle("binding", "handoff-1", "open")

  let message = ""

  try {
    await result
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  expect(message).toContain("Could not open the system browser")
  expect(message).not.toContain("github.com")
  expect(events.at(-1)?.state).toBe("failed")
})

test("a closed tab or binding ends its waiting handoff", async () => {
  const { handoffs, events, begin } = setup()

  const result = begin()
  await flush()
  handoffs.cancelTab("binding", tab.second)
  expect(events.at(-1)?.state).toBe("pending")
  handoffs.cancelTab("binding", tab.first)
  expect(await result).toEqual({ state: "cancelled", host: "github.com" })

  const second = begin({ tabID: tab.second })
  await flush()
  handoffs.cancelBinding("binding")
  expect(await second).toEqual({ state: "cancelled", host: "github.com" })
})
