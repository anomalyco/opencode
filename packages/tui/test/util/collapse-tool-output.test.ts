import { expect, test } from "bun:test"
import { collapseShellOutput } from "../../src/util/collapse-tool-output"

test("does not count a clipped shell output line as an omitted line", () => {
  const output = "a".repeat(1300) + "END"
  const preview = collapseShellOutput("", output, 10, 920)
  expect(preview.overflow).toBe(true)
  expect(preview.output).toStartWith("(earlier output omitted)\n")
  expect(preview.output).toEndWith("END")
})

test("counts earlier shell output lines when the remaining lines fit", () => {
  expect(collapseShellOutput("", "one\ntwo\nthree\nfour", 3, 80).output).toBe("(2 earlier lines)\nthree\nfour")
})
