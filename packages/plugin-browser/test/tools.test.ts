import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { runInNewContext } from "node:vm"
import { Effect } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserFiles } from "../src/files.js"
import { BrowserSkill } from "../src/skill.js"
import { BrowserTools } from "../src/tools.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const navigate = (url: string) => BrowserTools.normalizeAction({ type: "navigate", tabID, url })

test("built-in browser skill uses a virtual skill:// URI", () => {
  expect(String(BrowserSkill.info.path)).toBe("skill://browser/SKILL.md")
})

test("URL normalization refuses extension pages, which would run with the extension's privileges", () => {
  for (const url of [
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html",
    "moz-extension://x/popup.html",
    "blob:chrome-extension://abcdefghijklmnopabcdefghijklmnop/0b6f7c2e",
  ]) {
    expect(() => navigate(url)).toThrow(Browser.extensionPageRefusal(url))
    expect(() => BrowserTools.normalizeAction({ type: "tabs.open", url })).toThrow(
      "Agent browser tools cannot open extension pages",
    )
  }
})

test("URL normalization rejects filesystem paths instead of treating them as hostnames", () => {
  // 58 calls passed a local file to tabs.open or navigate; the error names it and says what to call instead.
  for (const path of [
    "/tmp/page.html",
    "./page.html",
    "../page.html",
    "C:\\Users\\me\\page.html",
    "D:/page.html",
    "file:///D:/site/index.html",
    "~/report.html",
  ])
    expect(() => navigate(path)).toThrow(
      `${JSON.stringify(path)} is a local file, not a web address. Use browser.preview({ path })`,
    )
  expect(() => navigate("ftp://example.com/file")).toThrow(
    '"ftp://example.com/file" is not a browser URL. Use an http:// or https:// address',
  )
  expect(() => navigate("https://user:secret@example.com")).toThrow("is not a browser URL")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
  // A subdomain of localhost is this machine too, as the pane's address bar reads it.
  expect(navigate("app.localhost:3000")).toEqual({ type: "navigate", tabID, url: "http://app.localhost:3000/" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
  expect(BrowserTools.normalizeAction({ type: "tabs.open", url: " " })).toEqual({
    type: "tabs.open",
    url: "about:blank",
  })
})

test("evaluate takes expression and code as script", () => {
  for (const key of ["script", "expression", "code"] as const)
    expect(BrowserTools.normalizeAction({ type: "evaluate", tabID, [key]: "document.title" })).toEqual({
      type: "evaluate",
      tabID,
      script: "document.title",
    })
  expect(
    BrowserTools.normalizeAction({ type: "evaluate", tabID, frameID: "frame", expression: "location.href" }),
  ).toEqual({ type: "evaluate", tabID, frameID: "frame", script: "location.href" })
  expect(() => BrowserTools.normalizeAction({ type: "evaluate", tabID })).toThrow(
    'browser.evaluate needs the JavaScript to run in script, for example browser.evaluate({ tabID, script: "document.title" }).',
  )
})

test("evaluate runs a script with a top-level return or await in an async function, returning its value", async () => {
  const wrapped = (script: string) => `(async () => {\n${script}\n})()`
  expect(BrowserTools.asyncBody("return document.title")).toBe(wrapped("return document.title"))
  expect(BrowserTools.asyncBody('const r = await fetch("/x"); return r.status')).toBe(
    wrapped('const r = await fetch("/x"); return r.status'),
  )
  // An awaited expression is the result, as in a DevTools console; before, it ran as a body and returned null.
  const run = (script: string) => runInNewContext(BrowserTools.asyncBody(script))
  expect(await run("await new Promise((resolve) => resolve(1))")).toBe(1)
  expect(await run("await Promise.resolve(2).then((value) => value + 1);")).toBe(3)
  expect(await run("const a = await Promise.resolve(4); return a + 1")).toBe(5)
  // Scripts that compile today keep their completion value: expressions, statement lists, nested returns, async IIFEs.
  for (const script of [
    "document.title",
    "const a = 1; a + 1",
    "[...document.querySelectorAll('a')].map((a) => { return a.href })",
    "(async () => { return await fetch('/x').then((r) => r.status) })()",
    "({ returnValue: 1, awaited: 2 })",
  ])
    expect(BrowserTools.asyncBody(script)).toBe(script)
  // A script that compiles neither way reaches the page unchanged, which reports its SyntaxError as before.
  expect(BrowserTools.asyncBody("return (")).toBe("return (")
  // A ref's script is a function that receives the element; it is never wrapped.
  const ref = Browser.Ref.make("e1")
  expect(BrowserTools.normalizeAction({ type: "evaluate", tabID, ref, script: "(element) => element.id" })).toEqual({
    type: "evaluate",
    tabID,
    ref,
    script: "(element) => element.id",
  })
})

test("URL normalization fails fast when percent-encoding exceeds the command bound", () => {
  const input = `https://example.com/${"é".repeat(400)}`
  expect(input.length).toBeLessThan(2_048)
  expect(new URL(input).href.length).toBeGreaterThan(2_048)
  expect(() => navigate(input)).toThrow("The URL is longer than 2048 characters once encoded.")
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

// Every browser.wait key shape seen across four devices (15,000 calls), with how often it failed and what it means now.
// 2,138 of 3,099 browser errors were "condition: Missing key" from these shapes.
describe("wait reads the condition from the keys models write", () => {
  const plan = (input: Omit<Parameters<typeof BrowserTools.waitPlan>[0], "type" | "tabID">) =>
    BrowserTools.waitPlan({ type: "wait", tabID, ...input })
  const desktop = (
    condition: "load" | "text" | "textGone",
    timeoutMs: number,
    text?: string,
  ): BrowserTools.WaitPlan => ({
    kind: "desktop",
    waited: condition,
    timeoutMs,
    action: { type: "wait", tabID, condition, ...(text === undefined ? {} : { text }), timeoutMs },
  })

  test.each([
    // 1,449 calls: { tabID, text, timeout }, with timeouts from 300 ms to 120 s.
    [{ text: "Done", timeout: 1_000 }, desktop("text", 1_000, "Done")],
    [{ text: "Done", timeout: 120_000 }, desktop("text", 30_000, "Done")],
    // 351: Playwright's state with text.
    [{ text: "Done", state: "visible" }, desktop("text", 10_000, "Done")],
    [{ text: "Spinner", state: "hidden" }, desktop("textGone", 10_000, "Spinner")],
    [{ text: "Spinner", state: "detached", timeout: 30_000 }, desktop("textGone", 30_000, "Spinner")],
    // 190: timeoutMs without condition, up to 180 s.
    [{ text: "Done", timeoutMs: 250 }, desktop("text", 250, "Done")],
    [{ text: "Done", timeoutMs: 180_000 }, desktop("text", 30_000, "Done")],
    // 33: text alone; 27: load state alone; 4: no keys.
    [{ text: "Done" }, desktop("text", 10_000, "Done")],
    [{ state: "load" }, desktop("load", 10_000)],
    [{ state: "networkidle" }, desktop("load", 10_000)],
    [{ state: "load", timeout: 5_000 }, desktop("load", 5_000)],
    [{}, desktop("load", 10_000)],
    // Playwright MCP's textGone.
    [{ textGone: "Loading" }, desktop("textGone", 10_000, "Loading")],
    // Shapes that worked before keep their meaning.
    [{ condition: "load" }, desktop("load", 10_000)],
    [{ condition: "text", text: "Done", timeoutMs: 30_000 }, desktop("text", 30_000, "Done")],
    [{ condition: "textGone", text: "Done", timeoutMs: 15_000 }, desktop("textGone", 15_000, "Done")],
    [{ condition: "load", timeout: 30_000 }, desktop("load", 30_000)],
  ] as const)("%j", (input, expected) => {
    expect(plan(input)).toEqual(expected)
  })

  test("selector, ref and state wait for an element; url waits for the address", () => {
    // 24 calls: { selector, timeout }.
    expect(plan({ selector: "#app .ready", timeout: 8_000 })).toEqual({
      kind: "element",
      waited: "element",
      element: { selector: "#app .ready" },
      gone: false,
      timeoutMs: 8_000,
    })
    expect(plan({ selector: ".spinner", state: "hidden", frameID: "frame" })).toEqual({
      kind: "element",
      waited: "elementGone",
      element: { selector: ".spinner" },
      gone: true,
      frameID: "frame",
      timeoutMs: 10_000,
    })
    const ref = Browser.Ref.make("e4")
    expect(plan({ ref })).toEqual({
      kind: "element",
      waited: "element",
      element: { ref },
      gone: false,
      timeoutMs: 10_000,
    })
    expect(plan({ url: "**/dashboard" })).toEqual({
      kind: "url",
      waited: "url",
      url: "**/dashboard",
      timeoutMs: 10_000,
    })
  })

  test("time, ms and delayMs pause", () => {
    // 29 calls { time } in milliseconds and 3 in seconds (Playwright MCP); 4 { ms }.
    expect(plan({ time: 3_000 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 3_000 })
    expect(plan({ time: 6 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 6_000 })
    expect(plan({ ms: 1_200 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 1_200 })
    expect(plan({ delayMs: 500 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 500 })
    expect(plan({ delayMs: 90_000 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 30_000 })
    expect(plan({ condition: "delay", timeout: 2_000 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 2_000 })
  })

  test("a lone timeout pauses for it, up to the maximum", () => {
    // 21 calls { timeout } or { timeoutMs } with no condition: attempted pauses. A load wait on a loaded page returns
    // at once.
    expect(plan({ timeout: 5_000 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 5_000 })
    expect(plan({ timeoutMs: 1_500 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 1_500 })
    expect(plan({ timeout: 120_000 })).toEqual({ kind: "delay", waited: "delay", timeoutMs: 30_000 })
  })

  test("an ambiguous or incomplete wait fails with one corrective example", () => {
    expect(() => plan({ text: "Done", selector: "#done" })).toThrow(
      'browser.wait takes one condition, but got text and selector. Wait for each in its own call, for example browser.wait({ tabID, text: "Saved" }).',
    )
    expect(() => plan({ condition: "text" })).toThrow(
      'browser.wait needs the text to look for, for example browser.wait({ tabID, text: "Saved" }).',
    )
    expect(() => plan({ condition: "element" })).toThrow(
      'browser.wait needs selector or ref, for example browser.wait({ tabID, selector: "#save" }).',
    )
    expect(() => plan({ condition: "delay" })).toThrow(
      "browser.wait needs a duration to pause, for example browser.wait({ tabID, delayMs: 500 }).",
    )
  })

  test("url matches a substring or a * glob of the whole address", () => {
    expect(BrowserTools.matchesURL("https://app.test/dashboard?tab=1", "/dashboard")).toBe(true)
    expect(BrowserTools.matchesURL("https://app.test/dashboard", "**/dashboard")).toBe(true)
    expect(BrowserTools.matchesURL("https://app.test/dashboard/settings", "**/dashboard")).toBe(false)
    expect(BrowserTools.matchesURL("https://app.test/a.b", "*/a.b")).toBe(true)
    expect(BrowserTools.matchesURL("https://app.test/axb", "*/a.b")).toBe(false)
  })
})

test("preview paths resolve the way the Review pane resolves them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-preview-"))
  try {
    await mkdir(join(directory, "site", "docs"), { recursive: true })
    await Bun.write(join(directory, "site", "index.html"), "<h1>hi</h1>")
    const locate = (path: string) => Effect.runPromise(BrowserFiles.locate(path, directory))
    const page = join(directory, "site", "index.html")
    const narrower = (path: string) => Effect.runPromise(BrowserFiles.locate(path, join(directory, "site", "docs")))
    await symlink(directory, join(directory, "site", "docs", "other"), process.platform === "win32" ? "junction" : "dir")
    for (const path of [page, "../index.html", "other/site/index.html"])
      expect(await narrower(path)).toMatchObject({ outside: true })
    for (const path of [
      "site/index.html",
      "./site/index.html",
      "site\\index.html",
      "site/index.html:3",
      "site/index.html#L2",
      page,
    ])
      expect(await locate(path)).toEqual({ absolute: page, found: true, directory: false })
    expect(await locate(pathToFileURL(page).href)).toEqual({ absolute: page, found: true, directory: false })
    // The pane opens the one workspace file whose path ends with a relative path that does not resolve.
    expect(await locate("index.html")).toMatchObject({ found: true })
    expect(await locate("missing.html")).toEqual({
      absolute: join(directory, "missing.html"),
      found: false,
      directory: false,
    })
    expect(await locate(join(directory, "nowhere", "x.png"))).toMatchObject({ found: false })
    // A backslash is a separator on every server, as it is in the pane.
    for (const path of ["site/docs", "site\\docs"])
      expect(await locate(path)).toEqual({ absolute: join(directory, "site", "docs"), found: false, directory: true })
    for (const path of ["https://example.com/report.html", "skill://browser/SKILL.md"])
      expect(await locate(path)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
