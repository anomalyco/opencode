import { expect, test } from "bun:test"
import { virtualScrollElement } from "./virtual-scroll-element"

test("resolves the connected viewport that owns the virtual root", () => {
  const stale = document.createElement("div")
  stale.className = "scroll-view__viewport"
  const viewport = document.createElement("div")
  viewport.className = "scroll-view__viewport"
  const root = document.createElement("div")
  viewport.append(root)
  document.body.append(viewport)

  expect(virtualScrollElement(root)).toBe(viewport)
  expect(virtualScrollElement(root)).not.toBe(stale)

  viewport.remove()
  expect(virtualScrollElement(root)).toBeNull()
})
