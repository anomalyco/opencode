import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { runInNewContext } from "node:vm"
import { Effect, Schema } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserFiles } from "../src/files.js"
import { BrowserSkill } from "../src/skill.js"
import { BrowserTools } from "../src/tools.js"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const navigate = (url: string) => BrowserTools.normalizeAction({ type: "navigate", tabID, url })

test("model-written aliases decode to canonical desktop actions; conflicting choices fail before dispatch", () => {
  const ref = Browser.Ref.make("e4")
  const fileID = Browser.FileID.make(`file_${crypto.randomUUID()}`)
  const parse = (input: Exclude<Browser.Input, { type: "wait" }>) => {
    const { type, ...fields } = input
    const operation = Browser.Operations.find(op => op.name === type)!
    Schema.decodeUnknownSync(operation.input)(fields)
    return BrowserTools.normalizeAction(input)
  }
  expect(parse({ type: "find", tabID, query: "Save" })).toEqual({ type: "find", tabID, text: "Save" })
  expect(parse({ type: "fill", tabID, ref, value: "" })).toEqual({ type: "fill", tabID, ref, text: "" })
  expect(parse({ type: "files.get", tabID, id: fileID })).toEqual({ type: "files.get", tabID, fileID })
  expect(parse({ type: "network.get", tabID, requestID: "r1", includeResponseBody: true })).toEqual({ type: "network.get", tabID, id: "r1", includeResponseBody: true })
  expect(() => parse({ type: "fill", tabID, ref, text: "keep", value: "replace" })).toThrow("Conflicting")
  expect(() => parse({ type: "find", tabID })).toThrow("Missing text")
  expect(() => parse({ type: "evaluate", tabID, expression: "1", code: "2" })).toThrow("Conflicting")
  expect(parse({ type: "evaluate", tabID, expression: "1", script: "1" })).toEqual({ type: "evaluate", tabID, script: "1" })
})

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
  // 58 calls passed a local file as the url of tabs.open or navigate; the error names it and says to pass it as path.
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html", "~/report.html"]) {
    expect(() => navigate(path)).toThrow(
      `${JSON.stringify(path)} is a local file, not a web address. Pass it as path: browser.navigate({ tabID, path }).`,
    )
    expect(() => BrowserTools.normalizeAction({ type: "tabs.open", url: path })).toThrow(
      `${JSON.stringify(path)} is a local file, not a web address. Pass it as path: browser.tabs.open({ path }).`,
    )
  }
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

test("a workspace file takes one route, whichever parameter names it", () => {
  const open = (input: { url?: string; path?: string; focus?: boolean }) => BrowserTools.normalizeAction({ type: "tabs.open", ...input })
  const move = (input: { url?: string; path?: string }) => BrowserTools.normalizeAction({ type: "navigate", tabID, ...input })
  // A path, or the address tabs.list shows for a file's tab: file: for this machine's workspace, workspace: for a remote server's.
  const addresses = ["file:///D:/site/index.html", "workspace://ses_1/site/index.html"]
  for (const file of ["site/index.html", " site/index.html#L2 ", "C:\\repo\\site\\index.html", "../outside.html", ...addresses]) {
    expect(open({ path: file })).toEqual({ type: "preview", path: file.trim() })
    expect(move({ path: file })).toEqual({ type: "navigate.path", tabID, path: file.trim() })
  }
  for (const url of addresses) {
    expect(open({ url })).toEqual({ type: "preview", path: url })
    expect(move({ url })).toEqual({ type: "navigate.path", tabID, path: url })
  }
  // A workspace file is always shown to the person, so focus does not travel with it.
  expect(open({ path: "site/index.html", focus: false })).toEqual({ type: "preview", path: "site/index.html" })
  expect(() => open({ url: "https://example.com", path: "site/index.html" })).toThrow("browser.tabs.open takes url or path, not both.")
  expect(() => move({ url: "https://example.com", path: "site/index.html" })).toThrow("browser.navigate takes url or path, not both.")
  expect(() => move({})).toThrow("browser.navigate needs url or path")
  // The address a file's tab loads from names a grant, not a file. The refusal says what to pass instead.
  for (const input of [{ url: "oc-preview://abc/site/index.html" }, { path: "oc-preview://abc/site/index.html" }]) {
    expect(() => open(input)).toThrow("Pass the file's own path to browser.tabs.open({ path })")
    expect(() => move(input)).toThrow("Pass the file's own path to browser.navigate({ tabID, path })")
  }
  for (const path of ["https://example.com/report.html", "skill://browser/SKILL.md", " "]) {
    expect(() => open({ path })).toThrow("browser.tabs.open needs path to name a workspace file")
    expect(() => move({ path })).toThrow("browser.navigate needs path to name a workspace file")
  }
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
  const files = [file(".."), file("."), file("CON.txt"), file("lpt1"), file("report.html")]
  const saved = await Effect.runPromise(BrowserFiles.save(files, BrowserFiles.exportPaths(files, tmpdir())))
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

test("uploads read the authorized regular file and preserve its display name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-upload-"))
  try {
    const path = join(dir, "sample.txt")
    await Bun.write(path, "sample")
    const paths = await Effect.runPromise(BrowserFiles.physical([path]))
    const [file] = await Effect.runPromise(BrowserFiles.read(paths, [path]))
    expect(file?.name).toBe("sample.txt")
    expect(new TextDecoder().decode(file?.data)).toBe("sample")
  } finally {
    await rm(dir, { recursive: true, force: true })
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
    expect(Browser.matchesURL("https://app.test/dashboard?tab=1", "/dashboard")).toBe(true)
    expect(Browser.matchesURL("https://app.test/dashboard", "**/dashboard")).toBe(true)
    expect(Browser.matchesURL("https://app.test/dashboard/settings", "**/dashboard")).toBe(false)
    expect(Browser.matchesURL("https://app.test/a.b", "*/a.b")).toBe(true)
    expect(Browser.matchesURL("https://app.test/axb", "*/a.b")).toBe(false)
    expect(Browser.matchesURL("abc", "ab*bc")).toBe(false)
    expect(Browser.matchesURL("https://app.test/some/path", "https://*/*/path")).toBe(true)
  })
})

test("a workspace file's path resolves the way the file panel resolves it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-preview-"))
  try {
    await mkdir(join(directory, "site", "docs"), { recursive: true })
    await Bun.write(join(directory, "site", "index.html"), "<h1>hi</h1>")
    const locate = (path: string) => Effect.runPromise(BrowserFiles.locate(path, directory, () => Effect.void))
    const page = join(directory, "site", "index.html")
    const narrower = (path: string) => Effect.runPromise(BrowserFiles.locate(path, join(directory, "site", "docs"), () => Effect.void))
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
    // No implicit directory walk for an agent: it has permission only for the exact entry it named.
    expect(await locate("index.html")).toMatchObject({ found: false })
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
    // A workspace reached through a link (macOS's tmpdir is under /private) keeps its own spelling and asks once.
    const linked = `${directory}-link`
    await symlink(directory, linked, process.platform === "win32" ? "junction" : "dir")
    const approved: string[] = []

    const through = await Effect.runPromise(
      BrowserFiles.locate("site/index.html", linked, (absolute) => Effect.sync(() => void approved.push(absolute))),
    )

    expect(through).toEqual({ absolute: join(linked, "site", "index.html"), found: true, directory: false })
    expect(approved).toEqual([join(linked, "site", "index.html")])
  } finally {
    await rm(`${directory}-link`, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
})
