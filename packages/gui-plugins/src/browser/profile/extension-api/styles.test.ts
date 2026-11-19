import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import type { Extension } from "electron"
import { runInNewContext } from "node:vm"
import { createHandlePath } from "../../disk/handle-path"
import { canStyle, createStyles } from "./styles"
import { apiManifest } from "./manifest"
import type { ExtensionTabs } from "./tabs"

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
    [top, "data:text/html,hi", "null", ["<all_urls>"], origin, true, false],
    [top, "blob:https://page.test/id", origin, ["<all_urls>"], origin, true, false],
    ["oc-preview://grant/report", child, "https://frame.test", grants, origin, true, false],
    ["workspace://session/report", child, "https://frame.test", grants, origin, true, false],
    ["artifact://art_x/", child, "https://frame.test", grants, origin, true, false],
    [top, "chrome-extension://other/private", "null", ["<all_urls>"], origin, true, false],
    [app, child, "https://frame.test", grants, origin, true, false],
    [top, app, "http://localhost:5173", ["<all_urls>"], undefined, true, false],
  ] as const) expect(canStyle(root, frame, inherited, hosts, gesture, blank, app)).toBe(ok)
})

// A tab-scoped transport: the receiver asks main again at delivery, then acknowledges the sheet. This drives
// the actual API argument decoder, permission checks, tab watcher and unload broadcast, not copies of them.
function fixture() {
  const root = "https://site.test/"
  const forgotten: string[] = []
  const css: string[] = []

  function frame(id: number, url: string) {
    const ipc = Object.assign(new EventEmitter(), {
      handleOnce(name: string, handler: () => void) { ipc.once(`request:${name}`, handler) },
      removeHandler(name: string) { ipc.removeAllListeners(`request:${name}`) },
    })

    const f = {
      url, origin: new URL(url).origin, frameTreeNodeId: id, detached: false, isDestroyed: () => false, ipc,
      send(name: string, channel: string) {
        if (name === "browser-extension:forget-css") { forgotten.push(channel);

 return }

        const [ask] = ipc.rawListeners(`request:${channel}`)
        const item = ask?.({ senderFrame: f })

        if (item) css.push(item.css)

        if (item?.remove && item.origin === "user" && id === 8) return void ipc.emit(channel, {}, "user-removal")
        ipc.emit(channel, {}, !!item && id !== 8)
      },
    }

    return f
  }

  const main = frame(4, root)
  const child = frame(8, root)
  const top = Object.assign(main, { framesInSubtree: [main, child] })
  const contents = Object.assign(new EventEmitter(), { id: 3, getURL: () => top.url, mainFrame: top, isDestroyed: () => false })
  const tab = { contents, window: { webContents: { getURL: () => "app://desktop/" } } }
  let release = () => {}

  const registry = { get: (id: number) => id === 3 ? tab : undefined, ids: () => [3], current: () => 3,
    watch(callback: (value: typeof tab) => () => void) { release = callback(tab);

 return () => release() },
  }

  const verifier = createHandlePath()
  // SAFETY: this fixture implements the registry and Electron frame operations used by createStyles above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const styles = createStyles(registry as unknown as ExtensionTabs, apiManifest, verifier)
  const extension: Extension = { id: "fixture", name: "Fixture", path: "", version: "1", url: "chrome-extension://fixture/", manifest: { permissions: ["activeTab"] } }
  const mv2 = (args: Parameters<(typeof styles.module.methods)[string]>[1]) => Promise.resolve().then(() => styles.module.methods["tabs.insertCSS"]!({ extension }, args))
  const mv3 = (target: { tabId: number; frameIds?: number[]; allFrames?: boolean }) => styles.module.methods["scripting.insertCSS"]!({ extension }, [{ target }])
  const navigate = (url: string) => { main.url = url; main.origin = new URL(url).origin; contents.emit("did-navigate") }

  return { root, styles, extension, mv2, mv3, navigate, close: () => release(), forgotten, css, verifier }
}

test("a toolbar grant covers only this tab and origin until cross-origin navigation, release or forget", async () => {
  const f = fixture()
  const style = () => f.mv2([{ code: "p{}" }]) // omitted tab ID resolves in the caller's window
  await expect(style()).rejects.toThrow(/^Cannot access contents of the page\.$/)
  f.styles.grant(f.extension, 3)
  await style()
  f.navigate(f.root + "other")
  await style()
  f.navigate("https://other.test/")
  f.navigate(f.root)
  await expect(style()).rejects.toThrow("Cannot access")
  f.styles.grant(f.extension, 3)
  f.close()
  await expect(style()).rejects.toThrow("Cannot access")
  f.styles.grant(f.extension, 3)
  f.styles.module.forget?.(f.extension.id)
  expect(f.forgotten).toEqual(["fixture", "fixture"])
  await expect(style()).rejects.toThrow("Cannot access")
})

test("private tops deny before frame selection on both paths; a lost child does not veto allFrames", async () => {
  const f = fixture()
  f.styles.grant(f.extension, 3)
  await f.mv2([{ allFrames: true, code: "p{}" }])
  await expect(Promise.resolve(f.styles.module.methods["tabs.removeCSS"]!({ extension: f.extension }, [{ allFrames: true, code: "p{}", cssOrigin: "user" }]))).rejects.toThrow("cannot remove a user-origin stylesheet")
  await expect(f.mv2([{ frameId: 8, code: "p{}" }])).rejects.toThrow("no longer available")
  expect(f.mv3({ tabId: 3, allFrames: true })).toEqual({ tabId: 3, frameIds: [0, 8] })
  f.navigate("oc-preview://private/report")

  for (const frameId of [0, 8, 9]) {
    await expect(f.mv2([{ frameId, code: "p{}" }])).rejects.toThrow(/^Cannot access contents of the page\.$/)
    expect(() => f.mv3({ tabId: 3, frameIds: [frameId] })).toThrow(/^Cannot access contents of the page\.$/)
  }

  await expect(f.mv2([undefined, { code: "p{}" }])).rejects.toThrow()
})

test("file CSS stays in the physical package and has a bounded read", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "css-package-"))

  try {
    const f = fixture()
    const pkg = path.join(dir, "package")
    await mkdir(pkg)
    await writeFile(path.join(dir, "outside.css"), "outside")
    await writeFile(path.join(pkg, "style.css"), "inside")
    await writeFile(path.join(pkg, "large.css"), Buffer.alloc(4 * 1024 * 1024 + 1))
    Object.assign(f.extension, { path: pkg })
    f.styles.grant(f.extension, 3)
    await f.mv2([{ file: "style.css" }])

    for (const file of ["../outside.css", "%2e%2e/outside.css", "//host/outside.css", "large.css"]) {
      await expect(f.mv2([{ file }])).rejects.toThrow()
    }

    expect(f.css).toEqual(["inside"])
    await f.verifier.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
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
