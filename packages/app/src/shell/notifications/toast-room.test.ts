import { expect, test } from "bun:test"
import { reserveToastRoom, toastMobileBottom } from "./toast-room"

test("a narrow window's toasts rise 8px above the tallest docked composer, and drop back once none is left", () => {
  const first = document.createElement("form")
  const second = document.createElement("form")
  expect(toastMobileBottom()).toBe(16)

  reserveToastRoom(first, 108)
  reserveToastRoom(second, 140)
  expect(toastMobileBottom()).toBe(148)

  reserveToastRoom(second, undefined)
  expect(toastMobileBottom()).toBe(116)

  reserveToastRoom(first, undefined)
  expect(toastMobileBottom()).toBe(16)
})
