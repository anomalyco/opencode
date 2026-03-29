import { expect, test } from "bun:test"
import PROMPT_INITIALIZE from "../../src/command/template/initialize.txt"

test("init template does not enforce a hard line cap", () => {
  expect(PROMPT_INITIALIZE).not.toContain("about 150 lines")
  expect(PROMPT_INITIALIZE).toContain("Be comprehensive")
})
