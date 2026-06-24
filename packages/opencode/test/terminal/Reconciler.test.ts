import { test, expect } from "bun:test"
import { Reconciler } from "@/terminal/app/Reconciler"
import { widgetStub } from "./lib/widget-stub"

test("first diff always marks dirty", () => {
  const r = new Reconciler()
  let dirtyCalled = false
  const w = widgetStub({ invalidate: () => { dirtyCalled = true } })

  r.diff("a", { content: "hello" }, w)
  expect(dirtyCalled).toBe(true)
})

test("same props does not mark dirty", () => {
  const r = new Reconciler()
  let count = 0
  const w = widgetStub({ invalidate: () => { count++ } })

  r.diff("a", { content: "hello" }, w)
  r.diff("a", { content: "hello" }, w)

  expect(count).toBe(1)
})

test("changed props marks dirty", () => {
  const r = new Reconciler()
  let count = 0
  const w = widgetStub({ invalidate: () => { count++ } })

  r.diff("a", { content: "hello" }, w)
  r.diff("a", { content: "world" }, w)

  expect(count).toBe(2)
})

test("different widgets with same id share state", () => {
  const r = new Reconciler()
  let count = 0
  const w1 = widgetStub({ invalidate: () => { count++ } })
  const w2 = widgetStub({ invalidate: () => { count++ } })

  r.diff("x", { v: 1 }, w1)
  r.diff("x", { v: 1 }, w2)

  expect(count).toBe(1)
})

test("reset clears all state", () => {
  const r = new Reconciler()
  let count = 0
  const w = widgetStub({ invalidate: () => { count++ } })

  r.diff("a", { content: "hello" }, w)
  r.reset()
  r.diff("a", { content: "hello" }, w)

  expect(count).toBe(2)
})

test("return value indicates change", () => {
  const r = new Reconciler()
  const w = widgetStub()

  expect(r.diff("a", { v: 1 }, w)).toBe(true)
  expect(r.diff("a", { v: 1 }, w)).toBe(false)
  expect(r.diff("a", { v: 2 }, w)).toBe(true)
})
