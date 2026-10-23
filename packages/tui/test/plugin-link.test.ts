import { expect, test } from "bun:test"
import type { LinkOpenHook } from "@opencode/plugin/tui/context"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"
import { createLinkResolver } from "../src/plugin/link"

test("link hooks run in plugin order, observe earlier changes, and leave the input untouched", async () => {
  const seen: unknown[] = []
  const first: LinkOpenHook = (event) => {
    seen.push({ ...event })
    event.url = `${event.url}?first`
  }
  const second: LinkOpenHook = async (event) => {
    seen.push({ ...event })
    event.url = `${event.url}&second`
  }
  const sources: Record<string, LinkOpenHook>[] = [{ a: first }, {}, { b: second }]
  const resolve = createLinkResolver(() => sources)
  const input = { url: "https://example.com", sessionID: "ses_test" }

  expect(await resolve(input)).toBe("https://example.com?first&second")
  expect(seen).toEqual([
    { url: "https://example.com", sessionID: "ses_test" },
    { url: "https://example.com?first", sessionID: "ses_test" },
  ])
  expect(input.url).toBe("https://example.com")
})

test("link resolver returns the clicked URL without hooks", async () => {
  expect(await createLinkResolver(() => [])({ url: "https://example.com" })).toBe("https://example.com")
})

test("plugin link hooks register through the registry and unregister once", () => {
  const links = new Map<string, unknown>()
  const removed: string[] = []
  const registry: Registry = {
    has: () => false,
    set: (kind: string, name: string, value: unknown) => void (kind === "links" && links.set(name, value)),
    remove: (kind, name) => void removed.push(`${kind}:${name}`),
    active: () => true,
  }
  const host = {
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
  } as unknown as ReturnType<typeof usePluginHost>
  const context = createPluginContext({ host, id: "test", options: undefined, owned: [], registry })
  const hook: LinkOpenHook = () => {}
  const unregister = context.link.hook("open", hook)

  expect([...links.entries()]).toEqual([["link#0", hook]])
  unregister()
  unregister()
  expect(removed).toEqual(["links:link#0"])
})
