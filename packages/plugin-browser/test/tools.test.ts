import { describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { basename, dirname } from "node:path"
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
      `${JSON.stringify(path)} is a local file, not a web address, so the browser cannot open it. To show it to the user, call browser.preview({ path: ${JSON.stringify(path)} }) instead;`,
    )
  expect(() => navigate("ftp://example.com/file")).toThrow(
    '"ftp://example.com/file" is not a browser URL. Use an http:// or https:// address',
  )
  expect(() => navigate("https://user:secret@example.com")).toThrow("is not a browser URL")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
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

test("evaluate runs a script with a top-level return or await as an async function body", () => {
  const wrapped = (script: string) => `(async () => {\n${script}\n})()`
  expect(BrowserTools.asyncBody("return document.title")).toBe(wrapped("return document.title"))
  expect(BrowserTools.asyncBody('const r = await fetch("/x"); return r.status')).toBe(
    wrapped('const r = await fetch("/x"); return r.status'),
  )
  expect(BrowserTools.asyncBody("await new Promise((resolve) => resolve(1))")).toBe(
    wrapped("await new Promise((resolve) => resolve(1))"),
  )
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
    // 33: text alone; 27: load state alone; 12: no keys; 13: timeout alone.
    [{ text: "Done" }, desktop("text", 10_000, "Done")],
    [{ state: "load" }, desktop("load", 10_000)],
    [{ state: "networkidle" }, desktop("load", 10_000)],
    [{}, desktop("load", 10_000)],
    [{ timeout: 5_000 }, desktop("load", 5_000)],
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
      element: { selector: "#app .ready" },
      gone: false,
      timeoutMs: 8_000,
    })
    expect(plan({ selector: ".spinner", state: "hidden", frameID: "frame" })).toEqual({
      kind: "element",
      element: { selector: ".spinner" },
      gone: true,
      frameID: "frame",
      timeoutMs: 10_000,
    })
    const ref = Browser.Ref.make("e4")
    expect(plan({ ref })).toEqual({ kind: "element", element: { ref }, gone: false, timeoutMs: 10_000 })
    expect(plan({ url: "**/dashboard" })).toEqual({ kind: "url", url: "**/dashboard", timeoutMs: 10_000 })
  })

  test("time, ms and delayMs pause", () => {
    // 29 calls { time } in milliseconds and 3 in seconds (Playwright MCP); 4 { ms }.
    expect(plan({ time: 3_000 })).toEqual({ kind: "delay", timeoutMs: 3_000 })
    expect(plan({ time: 6 })).toEqual({ kind: "delay", timeoutMs: 6_000 })
    expect(plan({ ms: 1_200 })).toEqual({ kind: "delay", timeoutMs: 1_200 })
    expect(plan({ delayMs: 500 })).toEqual({ kind: "delay", timeoutMs: 500 })
    expect(plan({ delayMs: 90_000 })).toEqual({ kind: "delay", timeoutMs: 30_000 })
    expect(plan({ condition: "delay", timeout: 2_000 })).toEqual({ kind: "delay", timeoutMs: 2_000 })
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
