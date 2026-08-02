import { expect, test } from "bun:test"
import { lookupAppOptions } from "./apps"

test("hides Windows app lookup helper windows", () => {
  expect(lookupAppOptions("win32")).toEqual({ windowsHide: true })
  expect(lookupAppOptions("darwin")).toEqual({ windowsHide: false })
})
