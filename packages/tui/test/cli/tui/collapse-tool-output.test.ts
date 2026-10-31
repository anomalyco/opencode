import { expect, test } from "bun:test"
import { collapseShellOutput, collapseToolOutput } from "../../../src/util/collapse-tool-output"

test("limits command input and output to the same line budget", () => {
  const command = Array.from({ length: 8 }, (_, index) => `command ${index + 1}`).join("\n")
  const output = Array.from({ length: 4 }, (_, index) => `output ${index + 1}`).join("\n")
  const collapsed = collapseToolOutput(`$ ${command}\n\n${output}`, 10, 1_000)

  expect(collapsed.overflow).toBe(true)
  expect(collapsed.output.split("\n")).toHaveLength(10)
  expect(collapsed.output).toContain("$ command 1")
  expect(collapsed.output).toContain("command 8\n\noutput 1…")
  expect(collapsed.output).not.toContain("output 2")
})

test("cuts the shell command after the configured rows and keeps the output's tail in the rest", () => {
  const command = Array.from({ length: 8 }, (_, index) => `command ${index + 1}`).join("\n")
  const output = Array.from({ length: 30 }, (_, index) => `output ${index + 1}`).join("\n")

  const standard = collapseShellOutput(command, output, 10, 1_000)
  expect(standard.input.split("\n")).toHaveLength(2)
  expect(standard.output.split("\n")[0]).toBe("(24 earlier lines)")

  const wider = collapseShellOutput(command, output, 20, 2_000, 5)
  expect(wider.input.split("\n")).toHaveLength(5)
  expect(wider.input).toContain("command 5")
  expect(wider.input).not.toContain("command 6")
  expect(wider.output.split("\n")).toHaveLength(14)
  expect(wider.output.split("\n")[0]).toBe("(17 earlier lines)")
  expect(wider.overflow).toBe(true)
})
