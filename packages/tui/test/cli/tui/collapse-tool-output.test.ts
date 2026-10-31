import { expect, test } from "bun:test"
import { collapseToolOutput, patchBodyLines } from "../../../src/util/collapse-tool-output"

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

test("counts patch lines without the file headers", () => {
  const patch = ["Index: a.ts", "===", "--- a.ts", "+++ a.ts", "@@ -1,2 +1,2 @@", "-one", "+uno", " two", ""].join("\n")

  expect(patchBodyLines(patch)).toBe(3)
  expect(patchBodyLines(`${patch.trimEnd()}\n@@ -9 +9 @@\n-x\n+y\n\\ No newline at end of file`)).toBe(5)
  expect(patchBodyLines("Index: a.ts\n")).toBe(0)
})
