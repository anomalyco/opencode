import { expect, test } from "bun:test"
import { knownProjectWorktrees } from "./project-suggestions"

test("suggests known projects that are neither open nor recently closed", () => {
  expect(
    knownProjectWorktrees({
      open: ["/code/open"],
      recentlyClosed: ["/code/recent"],
      known: ["/code/open", "/code/recent", "/code/known", "/code/other"],
      limit: 5,
    }),
  ).toEqual(["/code/known", "/code/other"])
})

test("deduplicates paths using platform path semantics and caps suggestions", () => {
  expect(
    knownProjectWorktrees({
      open: ["/code/open/"],
      recentlyClosed: [],
      known: ["/code/open", "/code/one", "/code/two"],
      limit: 1,
    }),
  ).toEqual(["/code/one"])
})
