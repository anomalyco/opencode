import { expect, test } from "bun:test"
import { createDialogStackTransitions } from "./dialog"

function entry(id: string) {
  let closed = 0
  let disposed = 0
  let notified = false
  return {
    id,
    notifyClose: () => {
      if (notified) return
      notified = true
      closed++
    },
    dispose: () => {
      disposed++
    },
    get closed() {
      return closed
    },
    get disposed() {
      return disposed
    },
  }
}

test("show replaces a pushed dialog without closing its replacement", () => {
  const transitions = createDialogStackTransitions<ReturnType<typeof entry>>()
  const first = entry("A")
  const second = entry("B")
  const firstHandle = transitions.push(() => first)
  const secondHandle = transitions.show(() => second)

  expect(first.closed).toBe(1)
  expect(first.disposed).toBe(1)
  expect(second.closed).toBe(0)
  firstHandle.close()
  expect(second.closed).toBe(0)
  secondHandle.close()
  expect(second.closed).toBe(1)
})

test("show settles a pending close only once", () => {
  const transitions = createDialogStackTransitions<ReturnType<typeof entry>>()
  const first = entry("A")
  const second = entry("B")
  const firstHandle = transitions.push(() => first)

  firstHandle.close()
  transitions.show(() => second)
  firstHandle.close()

  expect(first.closed).toBe(1)
  expect(first.disposed).toBe(1)
  expect(second.closed).toBe(0)
})

test("a handle closes only its matching pushed dialog when another dialog is above it", () => {
  const transitions = createDialogStackTransitions<ReturnType<typeof entry>>()
  const first = entry("A")
  const second = entry("B")
  const firstHandle = transitions.push(() => first)
  transitions.push(() => second)

  firstHandle.close()

  expect(first.closed).toBe(1)
  expect(second.closed).toBe(0)
})
