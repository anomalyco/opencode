import { afterEach, expect, mock, spyOn, test } from "bun:test"
import * as Open from "@opencode/util/open"
import type { LinkTarget } from "@opencode/plugin/tui/context"
import { createLinkRegistry } from "../src/context/link"
import { createPluginContext, type Dispose, type Registry, type usePluginHost } from "../src/plugin/api"

type Host = ReturnType<typeof usePluginHost>

afterEach(() => mock.restore())

function setup() {
  const opened: string[] = []
  const record = async (target: string) => {
    opened.push(target)
    return undefined as never
  }
  spyOn(Open, "openUrl").mockImplementation(record)
  spyOn(Open, "openPath").mockImplementation(record)
  const links = createLinkRegistry()
  const owned: Dispose[] = []
  const host = {
    links,
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
  } as unknown as Host
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  const context = createPluginContext({ host, id: "test", options: undefined, owned, registry })
  const deactivate = () => Promise.all(owned.map((dispose) => dispose()))
  return { opened, links, register: context.ui.links.register, deactivate }
}

test("a handler that unregisters itself while declining still lets the next handler claim", async () => {
  const harness = setup()
  const seen: LinkTarget[] = []
  const unregister = harness.register(() => {
    unregister()
    return false
  })
  harness.register((link) => {
    seen.push(link)
    return true
  })
  await harness.links.openUrl("https://example.com")
  expect(seen).toEqual([{ type: "url", url: "https://example.com" }])
  expect(harness.opened).toEqual([])
})

test("unregistering one of two registrations of the same handler keeps the other", async () => {
  const harness = setup()
  const handler = (link: LinkTarget) => link.type === "path"
  const first = harness.register(handler)
  harness.register(handler)
  first()
  first()
  await harness.links.openPath("/repo")
  expect(harness.opened).toEqual([])
})

test("deactivation removes handlers and later registrations stay inert", async () => {
  const harness = setup()
  harness.register(() => true)
  await harness.deactivate()
  harness.register(() => true)
  await harness.links.openUrl("https://example.com")
  expect(harness.opened).toEqual(["https://example.com"])
})
