import { describe, expect, test } from "bun:test"
import { findShortcut, scrollTopForRange } from "./file-find"

describe("findShortcut", () => {
  test("opens find from an editable target", () => {
    expect(findShortcut({ metaKey: true, ctrlKey: false, key: "f" }, true)).toBe("find")
  })

  test("does not handle find without a modifier", () => {
    expect(findShortcut({ metaKey: false, ctrlKey: false, key: "f" }, false)).toBeUndefined()
  })

  test("keeps next-match navigation out of editable targets", () => {
    expect(findShortcut({ metaKey: false, ctrlKey: true, key: "g" }, true)).toBeUndefined()
    expect(findShortcut({ metaKey: false, ctrlKey: true, key: "g" }, false)).toBe("next")
  })
})

test("centers the current match in the scroll viewport", () => {
  expect(
    scrollTopForRange({
      scrollTop: 400,
      viewportTop: 100,
      viewportHeight: 600,
      matchTop: 900,
      matchHeight: 20,
    }),
  ).toBe(910)
})
