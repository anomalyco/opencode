import { expect, test } from "bun:test"
import { navigationTurn, replacementNavigation } from "./navigation-turn"
import { createDocumentState, transitionDocument } from "./page-machine"

test.each(["navigate", "reload"] as const)("%s joins the unissued preview restore that bootstraps CDP", async method => {
  const issued: string[] = []
  const turn = navigationTurn(undefined, () => {}, () => {})
  const restore = turn.begin(new AbortController().signal)
  const saved = "file:///work/report.html"
  expect(turn.interrupt(method, saved)).toBe(method === "reload" ? saved : undefined)
  await restore("oc-preview://test/report.html", () => { issued.push(saved) })
  expect(issued).toEqual([saved])
})

test.each([true, false])("an abort waits for the replacement document, not the original commit: committed=%s", async committed => {
  const next = replacementNavigation()
  const start = { isMainFrame: true, isSameDocument: false }
  const aborted = Object.assign(new Error("aborted"), { errno: -3 })
  next.start(start)
  next.commit()
  next.start({ ...start, isSameDocument: true })
  next.start({ ...start, isMainFrame: false })
  expect(next.after(aborted)).toBeUndefined()
  next.start(start)
  const result = next.after(aborted)

  if (committed) next.commit()
  next.stop()
  expect(await result).toBe(committed)
  expect(next.after(new Error("network error"))).toBeUndefined()
})

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

test("interrupting an unissued restore preserves its address; stopping an agent navigation does not propose one", async () => {
  for (const [method, restoring, keep, expected] of [["back", "https://saved.test", true, "https://saved.test"], ["forward", "https://saved.test", true, "https://saved.test"], ["stop", undefined, true, "https://saved.test"], ["stop", undefined, false, undefined]] as const) {
    const gate = Promise.withResolvers<void>()
    const stopped: (string | undefined)[] = []
    const navigation = navigationTurn(() => gate.promise, () => {}, () => {}, address => stopped.push(address))
    const visit = navigation.begin(new AbortController().signal, keep)("https://saved.test", () => { throw Error("load was issued") })
    navigation.interrupt(method, restoring)
    gate.resolve()
    await visit
    expect(stopped).toEqual([expected])
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

test("a person's new address replaces a held restore without issuing it", async () => {
  const issued: string[] = []
  const stopped: (string | undefined)[] = []
  const gate = Promise.withResolvers<void>()
  const turn = navigationTurn(() => gate.promise, () => {}, () => {}, url => stopped.push(url))
  const url = "https://saved.invalid"
  const restore = turn.begin(new AbortController().signal)(url, () => { issued.push(url) })
  turn.interrupt("navigate", url, "user")
  gate.resolve()
  await restore
  expect(issued).toEqual([])
  expect(stopped).toEqual([url])
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
