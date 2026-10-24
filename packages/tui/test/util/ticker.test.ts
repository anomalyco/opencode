import { expect, test } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createTicker } from "../../src/util/ticker"

test("the ticker runs only while held and stops on the first tick after release", async () => {
  const ticker = createTicker(10)
  expect(ticker.running()).toBe(false)
  const release = ticker.hold()
  expect(ticker.running()).toBe(true)
  const start = ticker.now()
  await Bun.sleep(40)
  expect(ticker.now()).toBeGreaterThan(start)
  release()
  release()
  expect(ticker.running()).toBe(true)
  await Bun.sleep(30)
  expect(ticker.running()).toBe(false)
})

test("one ticker serves every watcher and stops once none is left", async () => {
  const ticker = createTicker(10)
  const [running, setRunning] = createSignal(true)
  const dispose = createRoot((dispose) => {
    createMemo(() => (running() ? ticker.watch() : undefined))
    createMemo(() => ticker.watch())
    return dispose
  })
  await Bun.sleep(30)
  expect(ticker.running()).toBe(true)
  setRunning(false)
  await Bun.sleep(30)
  expect(ticker.running()).toBe(true)
  dispose()
  await Bun.sleep(30)
  expect(ticker.running()).toBe(false)
})
