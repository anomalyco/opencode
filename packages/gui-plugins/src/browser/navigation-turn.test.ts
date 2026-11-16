import { expect, test } from "bun:test"
import { navigationTurn } from "./navigation-turn"

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
