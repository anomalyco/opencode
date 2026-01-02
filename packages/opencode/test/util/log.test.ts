import { test, expect } from "bun:test"
import { Log } from "@/util/log"
import fs from "fs/promises"
import path from "path"
import * as Global from "@/global"

describe("Log", () => {
  const testLogDir = path.join(process.cwd(), ".test-log")
  const logDir = path.join(testLogDir, "share", "opencode", "log")

  test("should not delete existing log file when reinitializing with DEBUG", async () => {
    await fs.mkdir(testLogDir, { recursive: true })
    await fs.mkdir(logDir, { recursive: true })

    await Log.init({ print: true })
    const initialLogPath = Log.file()
    expect(initialLogPath).toBeTruthy()
    expect(initialLogPath).toContain(logDir)

    const initialContent = "Initial log content\n"
    await fs.appendFile(initialLogPath, initialContent)

    await Log.init({ print: true, level: "DEBUG" })
    const debugLogPath = Log.file()

    const initialExists = await fs
      .access(initialLogPath)
      .then(() => true)
      .catch(() => false)
    expect(initialExists).toBe(true)

    const initialFileContent = await fs.readFile(initialLogPath, "utf-8")
    expect(initialFileContent).toContain(initialContent)

    expect(debugLogPath).toBeTruthy()
    expect(debugLogPath).not.toBe(initialLogPath)

    await fs.rm(testLogDir, { recursive: true, force: true })
  })

  test("should maintain log rotation when reinitializing with DEBUG", async () => {
    await fs.mkdir(testLogDir, { recursive: true })
    await fs.mkdir(logDir, { recursive: true })

    const oldFiles: string[] = []
    for (let i = 0; i < 15; i++) {
      const timestamp = new Date(Date.now() - i * 1000 * 60 * 60 * 24)
      const filename = timestamp.toISOString().split(".")[0].replace(/:/g, "") + ".log"
      const filepath = path.join(logDir, filename)
      await fs.writeFile(filepath, `Old log ${i}\n`)
      oldFiles.push(filepath)
    }

    await Log.init({ print: true, level: "DEBUG" })

    const allFiles = (await fs.readdir(logDir)).sort()
    expect(allFiles.length).toBeLessThanOrEqual(10)

    const currentLogPath = Log.file()
    const currentExists = await fs
      .access(currentLogPath)
      .then(() => true)
      .catch(() => false)
    expect(currentExists).toBe(true)

    await fs.rm(testLogDir, { recursive: true, force: true })
  })
})
