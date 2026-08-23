import { expect, test } from "bun:test"
import { copy, handleSelectionKey } from "../../src/util/selection"

function createCopyHarness(text: string | null) {
  const writes: string[] = []
  const toasts: string[] = []
  let cleared = false
  const renderer = {
    getSelection: () =>
      text === null
        ? null
        : {
            getSelectedText: () => text,
            selectedRenderables: [],
          },
    clearSelection: () => {
      cleared = true
    },
  }
  const toast = {
    show: (input: { message: string }) => toasts.push(input.message),
    error: () => {},
  }
  const clipboard = {
    async read() {
      return undefined
    },
    async write(value: string) {
      writes.push(value)
    },
  }
  return { renderer, toast, clipboard, writes, toasts, cleared: () => cleared }
}

async function flushCopy(harness: ReturnType<typeof createCopyHarness>) {
  await Promise.resolve()
  await Promise.resolve()
  return harness
}

test("copy writes selected text without clearing the highlight", async () => {
  const harness = createCopyHarness("beta")
  expect(copy(harness.renderer, harness.toast, harness.clipboard)).toBe(true)
  await flushCopy(harness)
  expect(harness.writes).toEqual(["beta"])
  expect(harness.toasts).toEqual(["Copied to clipboard"])
  expect(harness.cleared()).toBe(false)
})

test("copy returns false when nothing is selected", () => {
  const harness = createCopyHarness(null)
  expect(copy(harness.renderer, harness.toast, harness.clipboard)).toBe(false)
  expect(harness.writes).toEqual([])
  expect(harness.cleared()).toBe(false)
})

test("ctrl+c copies without clearing and escape still dismisses", async () => {
  const harness = createCopyHarness("beta")
  const prevented: string[] = []
  handleSelectionKey(
    harness.renderer,
    harness.toast,
    {
      ctrl: true,
      name: "c",
      preventDefault: () => prevented.push("prevent"),
      stopPropagation: () => prevented.push("stop"),
    },
    harness.clipboard,
  )
  await flushCopy(harness)
  expect(harness.writes).toEqual(["beta"])
  expect(harness.cleared()).toBe(false)
  expect(prevented).toEqual(["prevent", "stop"])

  handleSelectionKey(
    harness.renderer,
    harness.toast,
    {
      name: "escape",
      preventDefault: () => {},
      stopPropagation: () => {},
    },
    harness.clipboard,
  )
  expect(harness.cleared()).toBe(true)
})
