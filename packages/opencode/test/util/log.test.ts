import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test"
import { Log } from "../../src/util/log"
import { Global } from "../../src/global"
import fs from "fs/promises"
import path from "path"

describe("Log.init", () => {
  const CLEANUP_THRESHOLD = 5

  beforeEach(clearLogDir)
  afterEach(clearLogDir)

  test("creates a new log file with timestamp name", async () => {
    setSystemTime(new Date("2026-01-07T15:00:00.000Z"))

    await Log.init({ print: false })

    const logFile = Log.file()
    expect(logFile).toBeTruthy()
    expect(path.basename(logFile)).toBe("2026-01-07T150000.log")
    expect(await Bun.file(logFile).exists()).toBe(true)

    setSystemTime()
  })

  test("creates dev.log when dev option is true", async () => {
    await Log.init({ print: false, dev: true })

    const logFile = Log.file()
    expect(path.basename(logFile)).toBe("dev.log")
    expect(await Bun.file(logFile).exists()).toBe(true)
  })

  test("does not delete files when at threshold", async () => {
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD, startingAt, ONE_DAY)
    await writeFiles(oldFiles)

    await Log.init({ print: false })

    for (const filename of oldFiles) {
      const file = getLogFile(filename)
      expect(await file.exists()).toBe(true)
    }
  })

  test("does not delete files when threshold exceeded by 5", async () => {
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD + 5, startingAt, ONE_DAY)
    await writeFiles(oldFiles)

    await Log.init({ print: false })

    for (const filename of oldFiles) {
      const file = getLogFile(filename)
      expect(await file.exists()).toBe(true)
    }
  })

  test("deletes the oldest file when threshold exceeded by 6", async () => {
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD + 6, startingAt, ONE_DAY)
    await writeFiles(oldFiles)

    await Log.init({ print: false })

    const file = getLogFile("2020-01-01T000000.log")
    expect(await file.exists()).toBe(false)
  })

  test("preserves the newest 10 files when threshold exceeded by 6", async () => {
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD + 6, startingAt, ONE_DAY)
    const newestFiles = oldFiles.slice(-10)
    await writeFiles(oldFiles)

    await Log.init({ print: false })

    for (const filename of newestFiles) {
      const file = getLogFile(filename)
      expect(await file.exists()).toBe(true)
    }
  })

  test("does not delete dev.log during cleanup", async () => {
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD + 6, startingAt, ONE_DAY)
    await writeFiles([...oldFiles, "dev.log"])

    await Log.init({ print: false })

    const file = getLogFile("dev.log")
    expect(await file.exists()).toBe(true)
  })

  test("creates new log file after cleanup runs", async () => {
    setSystemTime(new Date("2025-11-02T00:00:00.000Z"))
    const startingAt = new Date("2020-01-01")
    const oldFiles = createLogFiles(CLEANUP_THRESHOLD + 6, startingAt, ONE_DAY)
    await writeFiles(oldFiles)

    await Log.init({ print: false })

    const oldestFile = getLogFile("2020-01-01T000000.log")
    const newFile = getLogFile("2025-11-02T000000.log")
    expect(await oldestFile.exists()).toBe(false)
    expect(await newFile.exists()).toBe(true)

    setSystemTime()
  })
})

async function clearLogDir() {
  const existingLogFiles = await fs.readdir(Global.Path.log).catch(() => [])

  await Promise.all(
    existingLogFiles.map((existingLogFile) => {
      const filepath = path.join(Global.Path.log, existingLogFile)
      return fs.unlink(filepath).catch(() => {})
    }),
  )
}

function writeFiles(filenames: string[]) {
  return Promise.all(filenames.map((f) => Bun.write(path.join(Global.Path.log, f), "test")))
}

function getLogFile(filename: string) {
  return Bun.file(path.join(Global.Path.log, filename))
}

const ONE_DAY = 1000 * 60 * 60 * 24

function createLogFiles(count: number, startDate: Date, increment = ONE_DAY): string[] {
  return Array.from({ length: count }, (_, index) => {
    const creationOffset = index * increment
    const fileCreatedAt = new Date(startDate.getTime() + creationOffset)
    return fileCreatedAt.toISOString().split(".")[0].replace(/:/g, "") + ".log"
  })
}
