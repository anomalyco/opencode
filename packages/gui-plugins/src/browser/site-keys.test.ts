import { expect, test } from "bun:test"
import { siteListMove, siteTypeAhead } from "./site-keys"

test("moves the active site by one, a page, or to the ends, and stops there", () => {
  expect(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].map((key) => siteListMove(key, 5, 100, 10))).toEqual([
    6, 4, 15, 0, 0, 99,
  ])
  expect([siteListMove("ArrowUp", 0, 3, 10), siteListMove("ArrowDown", 2, 3, 10), siteListMove("PageDown", 1, 3, 10)]).toEqual([
    0, 2, 2,
  ])
  expect([siteListMove("ArrowDown", 0, 0, 10), siteListMove("a", 0, 3, 10)]).toEqual([undefined, undefined])
})

test("jumps to the next site that starts with what was typed", () => {
  const sites = ["github.com", "gitlab.com", "google.com", "linear.app"]

  expect(siteTypeAhead(sites, 0, "l")).toBe(3)
  expect(siteTypeAhead(sites, 0, "gitl")).toBe(1)
  // Repeating a letter steps through the sites that start with it, wrapping at the end.
  expect(siteTypeAhead(sites, 1, "gg")).toBe(2)
  expect(siteTypeAhead(sites, 2, "g")).toBe(0)
  expect(siteTypeAhead(sites, 0, "z")).toBeUndefined()
})
