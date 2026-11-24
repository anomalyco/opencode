import { afterEach, expect, jest, test } from "bun:test"
import { createFilterGate } from "./filter-startup"

afterEach(() => { jest.useRealTimers() })

function setup() {
  jest.useFakeTimers()
  const lifetime = new AbortController()
  const page = new AbortController()
  const unconfirmed: string[] = []
  const gate = createFilterGate(lifetime.signal, id => unconfirmed.push(id))

  return { lifetime, page, unconfirmed, gate, visit: () => gate.wait("https://example.com", page.signal) }
}

test("a late listener releases HTTP on retry; workspace and artifact previews never join the wait", async () => {
  const { gate, page, visit, unconfirmed } = setup()
  let listening = false
  let opened = false
  gate.start("worker", async () => listening)
  const opening = visit()?.then(() => { opened = true })

  for (const url of ["oc-preview://host/file", "artifact:report", "file:///report.html", "about:blank"]) {
    expect(gate.wait(url, page.signal)).toBeUndefined()
  }

  await new Promise<void>(resolve => queueMicrotask(resolve))
  expect(opened).toBe(false)
  listening = true
  jest.advanceTimersToNextTimer()
  await opening
  expect(opened).toBe(true)
  expect(unconfirmed).toEqual([])
})

test("a crashed background and a hung worker share one deadline, even when registered apart", async () => {
  const { gate, visit, unconfirmed } = setup()
  gate.start("background", async () => { throw new Error("render process gone") })
  const opening = visit()
  jest.advanceTimersByTime(3000)
  gate.start("worker", () => new Promise(() => {}))
  jest.advanceTimersToNextTimer()
  await opening
  expect(unconfirmed).toEqual(["background", "worker"])
  expect(visit()).toBeUndefined()
})

test("closing one page cancels its navigation, quitting aborts pending probes and other pages", async () => {
  const { gate, page, lifetime, visit, unconfirmed } = setup()
  const stopped = Promise.withResolvers<void>()
  gate.start("worker", async signal => {
    signal.addEventListener("abort", () => stopped.resolve(), { once: true })
    await stopped.promise

    return false
  })
  const closing = visit()
  const other = gate.wait("http://example.org", new AbortController().signal)
  page.abort(new Error("closed tab"))
  await expect(closing).rejects.toThrow("closed tab")
  lifetime.abort(new Error("quit"))
  await expect(other).rejects.toThrow("quit")
  await stopped.promise
  expect(unconfirmed).toEqual([])
})
