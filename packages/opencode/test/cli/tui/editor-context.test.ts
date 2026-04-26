import { expect, test } from "bun:test"
import { offsetToPosition } from "../../../src/cli/cmd/tui/context/editor-zed"

test("offsetToPosition converts Zed offsets to 1-based editor positions", () => {
  expect(offsetToPosition("one\ntwo\nthree", 0)).toEqual({ line: 1, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 4)).toEqual({ line: 2, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 6)).toEqual({ line: 2, character: 3 })
  expect(offsetToPosition("one\ntwo\nthree", 100)).toEqual({ line: 3, character: 6 })
})
