import { describe, expect, test } from "bun:test"
import {
  executeLocalCommand,
  formatLocalCommandError,
  formatLocalCommandResult,
  LOCAL_COMMAND_OUTPUT_LIMIT,
} from "../../src/prompt/local-command"

describe("local command", () => {
  test("runs the command in the supplied local directory and captures its output", async () => {
    const result = await executeLocalCommand({
      command: process.platform === "win32" ? "cd" : "pwd",
      directory: process.cwd(),
    })

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.outputTruncated).toBe(false)
    expect(result.stdout.trim()).toBe(process.cwd())
  })

  test("preserves stderr and the non-zero exit code", async () => {
    const result = await executeLocalCommand({
      command: process.platform === "win32" ? "echo failed 1>&2 & exit /b 7" : "printf failed >&2; exit 7",
      directory: process.cwd(),
    })

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toContain("failed")
  })

  test("terminates commands that exceed the timeout", async () => {
    const started = Date.now()
    const result = await executeLocalCommand({
      command: process.platform === "win32" ? "ping -n 2 127.0.0.1 > nul" : "sleep 1",
      directory: process.cwd(),
      timeout: 100,
    })

    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(750)
  })

  test("caps captured process output", async () => {
    const size = LOCAL_COMMAND_OUTPUT_LIMIT + 1
    const result = await executeLocalCommand({
      command:
        process.platform === "win32"
          ? `bun -e "process.stdout.write('x'.repeat(${size}))"`
          : `bun -e 'process.stdout.write("x".repeat(${size}))'`,
      directory: process.cwd(),
    })

    expect(result.exitCode).toBe(0)
    expect(result.outputTruncated).toBe(true)
    expect(result.stdout).toHaveLength(LOCAL_COMMAND_OUTPUT_LIMIT)
  })

  test("formats failure and timeout results for inline display", () => {
    expect(
      formatLocalCommandResult({
        exitCode: 7,
        outputTruncated: false,
        stderr: "failed",
        stdout: "",
        timedOut: false,
      }),
    ).toBe("Command exited with code 7.\n\nfailed")
    expect(
      formatLocalCommandResult({
        exitCode: 1,
        outputTruncated: false,
        stderr: "",
        stdout: "",
        timedOut: true,
      }),
    ).toBe("Command stopped after reaching the local time limit.")
    expect(
      formatLocalCommandResult({
        exitCode: 0,
        outputTruncated: true,
        stderr: "",
        stdout: "\u001B[31mpartial output\u001B[0m\u0007",
        timedOut: false,
      }),
    ).toBe("partial output\n\nOutput truncated after 64 KiB.")
    expect(formatLocalCommandError(new Error("\u001B[31mfailed\u001B[0m\u0007"))).toBe(
      "Local command failed.\n\nfailed",
    )
  })
})
