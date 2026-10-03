import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { ConsoleGuard } from "../../src/util/console-guard"

function logFile() {
  return path.join(Global.Path.log, "opencode.log")
}

async function readLog() {
  const file = Bun.file(logFile())
  return (await file.exists()) ? await file.text() : ""
}

const original = {
  debug: console.debug,
  info: console.info,
  log: console.log,
  warn: console.warn,
  error: console.error,
}

describe("ConsoleGuard.installConsoleGuard", () => {
  test("routes console output to the log file instead of the terminal", async () => {
    try {
      ConsoleGuard.installConsoleGuard()
      console.warn("unknown format ignored in schema at path", { format: "uint64" })
      await new Promise((resolve) => setTimeout(resolve, 100))
      const log = await readLog()
      expect(log).toContain('service=console message="unknown format ignored in schema at path')
      expect(log).toContain("level=warn")
    } finally {
      restoreConsole()
    }
  })

  test("suppresses entries below the configured minimum level", async () => {
    const previous = process.env.OPENCODE_LOG_LEVEL
    process.env.OPENCODE_LOG_LEVEL = "ERROR"
    try {
      ConsoleGuard.installConsoleGuard()
      console.warn("guard should suppress this warn")
      console.error("guard should keep this error")
      await new Promise((resolve) => setTimeout(resolve, 100))
      const log = await readLog()
      expect(log).toContain("guard should keep this error")
      expect(log).not.toContain("guard should suppress this warn")
    } finally {
      restoreConsole()
      process.env.OPENCODE_LOG_LEVEL = previous
    }
  })
})

function restoreConsole() {
  console.debug = original.debug
  console.info = original.info
  console.log = original.log
  console.warn = original.warn
  console.error = original.error
}
