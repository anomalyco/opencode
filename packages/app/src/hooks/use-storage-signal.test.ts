import { beforeEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useStorageSignal } from "./use-storage-signal"

const yes = "true"

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test("loads and writes session strings by default", () => {
  sessionStorage.setItem("name", "saved")

  const root = createRoot((dispose) => {
    const hook = useStorageSignal("name", "init")
    return { value: hook[0], set: hook[1], dispose }
  })

  expect(root.value()).toBe("saved")

  root.set("next")

  expect(sessionStorage.getItem("name")).toBe("next")
  root.dispose()
})

test("writes session json values", () => {
  const root = createRoot((dispose) => {
    const hook = useStorageSignal("prefs", { open: false })
    return { value: hook[0], set: hook[1], dispose }
  })

  expect(root.value()).toEqual({ open: false })

  root.set({ open: true })

  expect(sessionStorage.getItem("prefs")).toBe(JSON.stringify({ open: true }))
  root.dispose()
})

test("loads and writes local strings", () => {
  localStorage.setItem("name", "saved")

  const root = createRoot((dispose) => {
    const hook = useStorageSignal("name", "init", { storage: "local" })
    return { value: hook[0], set: hook[1], dispose }
  })

  expect(root.value()).toBe("saved")

  root.set("next")

  expect(localStorage.getItem("name")).toBe("next")
  expect(sessionStorage.getItem("name")).toBeNull()
  root.dispose()
})

test("removes storage when stringify returns undefined", () => {
  localStorage.setItem("flag", yes)

  const root = createRoot((dispose) => {
    const hook = useStorageSignal("flag", true, {
      storage: "local",
      parse: (value) => value === yes,
      stringify: (value) => (value ? yes : undefined),
    })
    return { value: hook[0], set: hook[1], dispose }
  })

  expect(root.value()).toBe(true)

  root.set(false)

  expect(root.value()).toBe(false)
  expect(localStorage.getItem("flag")).toBeNull()
  root.dispose()
})
