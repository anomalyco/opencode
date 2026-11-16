import { expect, test } from "bun:test"
import { navigationTurn } from "./navigation-turn"
import { createDocumentState, transitionDocument } from "./page-machine"

test.each(["stop", "oc-preview://private/report", "https://next.test"])('a later %s wins over a deferred web navigation', async next => {
  const gate = Promise.withResolvers<void>()
  const issued: string[] = []
  const spinner: string[] = []
  const navigation = navigationTurn(url => url.startsWith("https:") ? gate.promise : undefined, url => spinner.push(url), () => spinner.push("stop"))
  const visit = (url: string) => navigation.begin(new AbortController().signal)(url, () => { issued.push(url) })
  const old = visit("https://first.test")
  await Promise.resolve()
  const last = next === "stop" ? navigation.cancel() : visit(next)
  gate.resolve()
  await Promise.all([old, last])
  expect(issued).toEqual(next === "stop" ? [] : [next])
  expect(spinner.slice(0, 2)).toEqual(["https://first.test", "stop"])
})

test("only a cross-document main-frame navigation supersedes a gated load", async () => {
  for (const [main, same, expected] of [[true, true, 1], [false, false, 1], [true, false, 0]] as const) {
    const gate = Promise.withResolvers<void>()
    const issued: string[] = []
    const navigation = navigationTurn(() => gate.promise, () => {}, () => {})
    const opening = navigation.begin(new AbortController().signal)("https://next.test", () => { issued.push("next") })
    navigation.nativeStart({ isMainFrame: main, isSameDocument: same })
    gate.resolve()
    await opening
    expect(issued).toHaveLength(expected)
  }
})

test("a gated history traversal settles the spinner when Chromium has no load to stop", async () => {
  const gate = Promise.withResolvers<void>()
  const events: string[] = []
  const navigation = navigationTurn(() => gate.promise, () => events.push("busy"), () => events.push("idle"))
  const back = navigation.begin(new AbortController().signal)("https://app.test/#one", () => { events.push("back") }, () => false)
  gate.resolve()
  await back
  expect(events).toEqual(["busy", "back", "idle"])
})

test("reload during a gated restore joins the saved load rather than bootstrapping a blank page", async () => {
  const url = "https://app.test/#report"
  let doc = createDocumentState({ url, title: "Report", generation: 1 })
  const gate = Promise.withResolvers<void>()
  const issued: string[] = []

  const navigation = navigationTurn(() => gate.promise, () => {
    doc = transitionDocument(doc, { type: "loading.started" }).state
  }, () => { doc = transitionDocument(doc, { type: "loading.stopped", title: "" }).state })

  const load = (address: string) => navigation.begin(new AbortController().signal)(address, () => { issued.push(address) })
  const restore = load(url)
  await Promise.resolve()
  const saved = navigation.interrupt("reload", doc.status === "restoring" ? doc.url : undefined)
  expect(doc).toMatchObject({ status: "restoring", url, busy: true })
  expect(saved).toBe(url)
  gate.resolve()
  await restore
  expect(issued).toEqual([url])
})
