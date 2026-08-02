import { expect, test } from "bun:test"
import { hiddenWindowOptions } from "./process-options"

test("hides subprocess windows only on Windows", () => {
  expect(hiddenWindowOptions("win32")).toEqual({ windowsHide: true })
  expect(hiddenWindowOptions("linux")).toEqual({ windowsHide: false })
})
