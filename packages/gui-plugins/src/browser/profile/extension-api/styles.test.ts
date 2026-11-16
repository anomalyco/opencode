import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { runInNewContext } from "node:vm"
import { canStyle } from "./styles"

test("CSS access requires the frame's host or a gesture for that top origin; private documents never qualify", () => {
  const top = "https://page.test/report"
  const child = "https://frame.test/embed"
  const grants = ["https://frame.test/*"]
  const origin = "https://page.test"
  const app = "http://localhost:5173/index.html"

  for (const [root, frame, inherited, hosts, gesture, blank, ok] of [
    [top, child, "https://frame.test", grants, undefined, false, true],
    [top, child, "https://frame.test", [], origin, false, false],
    [top, top, origin, [], origin, false, true],
    [top, top, origin, [], undefined, false, false],
    [top, "about:blank", origin, [], origin, true, true],
    [top, "about:srcdoc", origin, [], origin, false, false],
    [top, "about:blank", "null", ["<all_urls>"], origin, true, false],
    ["oc-preview://grant/report", child, "https://frame.test", grants, origin, true, false],
    ["workspace://session/report", child, "https://frame.test", grants, origin, true, false],
    ["artifact://art_x/", child, "https://frame.test", grants, origin, true, false],
    [top, "chrome-extension://other/private", "null", ["<all_urls>"], origin, true, false],
    [app, child, "https://frame.test", grants, origin, true, false],
    [top, app, "http://localhost:5173", ["<all_urls>"], undefined, true, false],
  ] as const) expect(canStyle(root, frame, inherited, hosts, gesture, blank, app)).toBe(ok)
})

test("a document removes only native sheet keys belonging to the same extension, text and origin", async () => {
  const source = await readFile(new URL("./frame-styles.js", import.meta.url), "utf8")
  const listeners = new Map<string, (...args: readonly unknown[]) => Promise<void> | void>()
  const removed: string[] = []
  let sequence = 0
  const item = { id: "one", css: "body{}", origin: "author", remove: false }
  const replies: (boolean | string)[] = []
  const ipcRenderer = { on: listeners.set.bind(listeners), invoke: async () => item, send: (_: string, reply: boolean | string) => replies.push(reply) }
  const webFrame = { insertCSS: () => String(++sequence), removeInsertedCSS: (key: string) => removed.push(key) }
  runInNewContext(source, { process: { type: "renderer", contextIsolated: true, sandboxed: true }, location: { protocol: "https:" }, document: { readyState: "complete" }, require: () => ({ ipcRenderer, webFrame }), addEventListener: listeners.set.bind(listeners) })
  const style = () => listeners.get("browser-extension:css")?.({}, "request", "document_start")
  await style()
  await style()
  item.id = "two"
  await style()
  item.origin = "user"
  await style()
  expect(sequence).toBe(3)
  item.remove = true
  await style()
  expect(replies.at(-1)).toBe("user-removal")
  expect(removed).toEqual([])
  item.origin = "author"
  await style()
  expect(removed).toEqual(["2"])
  listeners.get("browser-extension:forget-css")?.({}, "one")
  expect(removed).toEqual(["2", "1"])
  listeners.get("pagehide")?.()
  expect(removed).toEqual(["2", "1"])
})
