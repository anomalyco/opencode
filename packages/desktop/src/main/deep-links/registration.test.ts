import { expect, test } from "bun:test"
import { registersProtocol } from "./registration"

test.each([
  [true, undefined, true],
  [true, "0", true],
  [false, undefined, false],
  [false, "0", false],
  [false, "1", true],
])("packaged %s with OPENCODE_DESKTOP_REGISTER_PROTOCOL=%s registers opencode:// %s", (packaged, value, expected) => {
  expect(registersProtocol({ packaged }, value)).toBe(expected)
})
