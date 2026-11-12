import { expect, test } from "bun:test"
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
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html"])
    expect(() => navigate(path)).toThrow("Unsupported browser URL")
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
