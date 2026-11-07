import { expect, test } from "bun:test"
import { formatShellReport, shellReportOutput } from "./shell-report.js"

test("formats the exit code and status lines before the output", () => {
  expect(formatShellReport({ exitCode: 0, output: "out\n" })).toBe("Exit code: 0\nOutput:\nout\n")
  expect(
    formatShellReport({ exitCode: 143, status: ["Command timed out after 120s"], output: "server starting" }),
  ).toBe("Exit code: 143\nCommand timed out after 120s\nOutput:\nserver starting")
  expect(formatShellReport({ exitCode: "unknown", output: "" })).toBe("Exit code: unknown\nOutput:\n(no output)")
})

test.each([
  { exitCode: 0, output: "mini-output\n" },
  { exitCode: 7, output: "build failed\nOutput:\nagain\n" },
  { exitCode: 143, status: ["Command timed out after 120s"], output: "server starting" },
])("strips the header it formats: %o", (input) => {
  expect(shellReportOutput(formatShellReport(input))).toBe(input.output)
})

test("keeps the placeholder for empty output", () => {
  expect(shellReportOutput(formatShellReport({ exitCode: 143, output: "" }))).toBe("(no output)")
})

test.each([
  "line one\nline two\nOutput:\nnot a header",
  "Command moved to the background (shell ID: sh_1).\nOutput is streaming to: /tmp/out",
  "Exit code: 0 without an output line",
])("leaves text without the header unchanged: %s", (text) => {
  expect(shellReportOutput(text)).toBe(text)
})
