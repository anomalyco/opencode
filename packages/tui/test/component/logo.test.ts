import { expect, test } from "bun:test"
import { logoSize } from "../../src/component/logo"

test("logo reserve follows the production responsive breakpoints", () => {
  expect(logoSize(100, 11)).toEqual({ width: 0, height: 0 })
  expect(logoSize(21, 12)).toEqual({ width: 4, height: 3 })
  expect(logoSize(22, 12)).toEqual({ width: 19, height: 7 })
  expect(logoSize(43, 12)).toEqual({ width: 19, height: 7 })
  expect(logoSize(44, 12)).toEqual({ width: 39, height: 4 })
})
