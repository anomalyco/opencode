import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { Effect } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserFiles } from "../src/files.js"
import { BrowserServe } from "../src/serve.js"
import { BrowserTools } from "../src/tools.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const navigate = (url: string) => BrowserTools.normalizeAction({ type: "navigate", tabID, url })

test("URL normalization rejects filesystem paths and file URLs, and points at path instead", () => {
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html", "file:///tmp/a.html"])
    expect(() => navigate(path)).toThrow("pass path instead of url")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open", url: " " })).toEqual({
    type: "tabs.open",
    url: "about:blank",
  })
})

test("navigate takes exactly one destination", () => {
  expect(() => BrowserTools.normalizeAction({ type: "navigate", tabID })).toThrow("exactly one of url, path")
  expect(() =>
    BrowserTools.normalizeAction({ type: "navigate", tabID, url: "https://example.com", history: "back" }),
  ).toThrow("exactly one of url, path")
  expect(BrowserTools.normalizeAction({ type: "navigate", tabID, history: "back" })).toEqual({
    type: "navigate",
    tabID,
    history: "back",
  })
  expect(() =>
    BrowserTools.normalizeAction({ type: "tabs.open", url: "https://example.com", path: "index.html" }),
  ).toThrow("url or path, not both")
})

// `timeout` was the name agents wrote most; an undeclared key would be dropped and the wait would run ten seconds.
test("wait takes timeout as timeoutMs", () => {
  expect(BrowserTools.normalizeAction({ type: "wait", tabID, text: "Done", timeout: 1_000 })).toEqual({
    type: "wait",
    tabID,
    text: "Done",
    timeoutMs: 1_000,
  })
  expect(BrowserTools.normalizeAction({ type: "wait", tabID, timeout: 1_000, timeoutMs: 2_000 })).toEqual({
    type: "wait",
    tabID,
    timeoutMs: 2_000,
  })
})

test("URL normalization fails fast when percent-encoding exceeds the command bound", () => {
  const input = `https://example.com/${"é".repeat(400)}`
  expect(input.length).toBeLessThan(2_048)
  expect(new URL(input).href.length).toBeGreaterThan(2_048)
  expect(() => navigate(input)).toThrow()
})

test("saved capture names never escape their directory or name a Windows device", async () => {
  const file = (name: string) => ({
    id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
    name,
    mime: "text/plain",
    data: new TextEncoder().encode(name),
  })
  const saved = await Effect.runPromise(
    BrowserFiles.save([file(".."), file("."), file("CON.txt"), file("lpt1"), file("report.html")]),
  )
  try {
    expect(saved.map((entry) => basename(entry.path))).toEqual([
      "capture",
      "capture",
      "capture",
      "capture",
      "report.html",
    ])
    expect(saved.map((entry) => entry.name)).toEqual(["..", ".", "CON.txt", "lpt1", "report.html"])
    expect(await Bun.file(saved[0]!.path).text()).toBe("..")
  } finally {
    await rm(dirname(dirname(saved[0]!.path)), { recursive: true, force: true })
  }
})

test("a capture saved to a chosen path creates its folders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-save-"))
  try {
    const saved = await Effect.runPromise(
      BrowserFiles.save(
        [{ id: Browser.FileID.make(`file_${crypto.randomUUID()}`), name: "s.png", mime: "image/png", data: new Uint8Array([1, 2]) }],
        { path: "pr/after.png", directory },
      ),
    )
    expect(saved[0]?.path).toBe(join(directory, "pr", "after.png"))
    expect(new Uint8Array(await Bun.file(join(directory, "pr", "after.png")).arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Agents built throwaway servers (and one committed its fixtures) because tabs could not open local HTML.
test("a local file is served with its folder, and nothing outside the served root", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "browser-serve-"))
  const outside = await mkdtemp(join(tmpdir(), "browser-outside-"))
  try {
    await Bun.write(join(workspace, "site", "index.html"), '<link rel="stylesheet" href="../shared/a.css">')
    await Bun.write(join(workspace, "shared", "a.css"), "body{}")
    await writeFile(join(outside, "page.html"), "<p>outside</p>")
    await writeFile(join(outside, "secret.txt"), "no")

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const serve = yield* BrowserServe.make(workspace)
          const page = yield* serve.url("site/index.html")
          expect(page).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}\/site\/index\.html$/)
          expect(yield* Effect.promise(() => fetch(page).then((response) => response.text()))).toContain("a.css")
          const css = new URL("../shared/a.css", page).href
          expect(yield* Effect.promise(() => fetch(css).then((response) => response.text()))).toBe("body{}")
          const escape = page.replace("site/index.html", "..%2F..%2Fetc%2Fpasswd")
          expect(yield* Effect.promise(() => fetch(escape).then((response) => response.status))).toBe(404)

          // Outside the workspace only the file's own folder is served.
          const lone = yield* serve.url(join(outside, "page.html"))
          expect(yield* Effect.promise(() => fetch(lone).then((response) => response.text()))).toBe("<p>outside</p>")
          const sibling = new URL("secret.txt", lone).href
          expect(yield* Effect.promise(() => fetch(sibling).then((response) => response.text()))).toBe("no")
          const parent = new URL("../", lone).href
          expect(yield* Effect.promise(() => fetch(parent).then((response) => response.status))).toBe(404)

          const missing = yield* Effect.flip(serve.url("nope.html"))
          expect(missing.message).toContain("check that the file exists on the server")
        }),
      ),
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
