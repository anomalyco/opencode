import os from "os"
import path from "path"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "log-test-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("startup strategy", () => {
  test("each init creates a new file", async () => {
    const dir1 = path.join(tmpDir, "run1")
    const dir2 = path.join(tmpDir, "run2")
    await fs.mkdir(dir1, { recursive: true })
    await fs.mkdir(dir2, { recursive: true })

    await Log.init({ print: false, path: dir1, rotate: { kind: "startup" } })
    const first = Log.file()

    await Log.init({ print: false, path: dir2, rotate: { kind: "startup" } })
    const second = Log.file()

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })

  test("file name matches YYYY-MM-DDTHHMMSS.log format", async () => {
    const dir = path.join(tmpDir, "startup-fmt")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, path: dir, rotate: { kind: "startup" } })
    const file = path.basename(Log.file())

    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}\.log$/)
  })

  test("dev mode uses dev.log as file name", async () => {
    const dir = path.join(tmpDir, "startup-dev")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, dev: true, path: dir, rotate: { kind: "startup" } })
    expect(path.basename(Log.file())).toBe("dev.log")
  })

  test("cleans up old files beyond retention", async () => {
    const dir = path.join(tmpDir, "startup-retention")
    await fs.mkdir(dir, { recursive: true })

    // create 5 old log files that match the cleanup glob (*[0-9]*.log)
    const oldFiles = Array.from({ length: 5 }, (_, i) => {
      const name = `2024-01-0${i + 1}T000000.log`
      return path.join(dir, name)
    })
    await Promise.all(oldFiles.map((f) => fs.writeFile(f, "old")))

    // init with retention=3: cleanup runs before new file is created,
    // so it sees 5 old files and deletes the 2 oldest
    await Log.init({ print: false, path: dir, rotate: { kind: "startup", retention: 3 } })

    // poll until the 2 oldest files are deleted
    const oldest = [oldFiles[0], oldFiles[1]]
    const end = Date.now() + 2000
    while (Date.now() < end) {
      const gone = await Promise.all(oldest.map((f) => fs.access(f).then(() => false).catch(() => true)))
      if (gone.every(Boolean)) break
      await Bun.sleep(50)
    }

    // the 2 oldest files should be deleted
    for (const f of oldest) {
      await expect(fs.access(f)).rejects.toThrow()
    }
    // the 3 newest old files should still exist
    for (const f of oldFiles.slice(2)) {
      await expect(fs.stat(f)).resolves.toBeTruthy()
    }
  })

  test("log.info writes content to file", async () => {
    const dir = path.join(tmpDir, "startup-write")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, level: "DEBUG", path: dir, rotate: { kind: "startup" } })
    const logger = Log.create({ service: "test-startup-write" })
    logger.info("hello startup")

    // flush happens synchronously via writer.flush()
    await Bun.sleep(50)
    const content = await fs.readFile(Log.file(), "utf-8")
    expect(content).toContain("hello startup")
  })
})

describe("daily strategy", () => {
  test("same day init uses the same file", async () => {
    const dir = path.join(tmpDir, "daily-same")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, path: dir, rotate: { kind: "daily" } })
    const first = Log.file()

    await Log.init({ print: false, path: dir, rotate: { kind: "daily" } })
    const second = Log.file()

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(path.basename(first)).toBe(path.basename(second))
  })

  test("file name matches opencode-YYYY-MM-DD.log format", async () => {
    const dir = path.join(tmpDir, "daily-fmt")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, path: dir, rotate: { kind: "daily" } })
    const file = path.basename(Log.file())

    expect(file).toMatch(/^opencode-\d{4}-\d{2}-\d{2}\.log$/)
  })

  test("cleans up old files beyond retention", async () => {
    const dir = path.join(tmpDir, "daily-retention")
    await fs.mkdir(dir, { recursive: true })

    // create 10 old daily log files
    const oldFiles = Array.from({ length: 10 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0")
      return path.join(dir, `opencode-2024-01-${day}.log`)
    })
    await Promise.all(oldFiles.map((f) => fs.writeFile(f, "old")))

    // init with retention=5
    await Log.init({ print: false, path: dir, rotate: { kind: "daily", retention: 5 } })

    // wait for async cleanup
    await Bun.sleep(100)

    const remaining = await fs.readdir(dir)
    const logFiles = remaining.filter((f) => f.endsWith(".log"))
    // 5 old + 1 today = 6, but cleanup keeps only retention=5
    expect(logFiles.length).toBeLessThanOrEqual(5)
  })

  test("log.info writes content to file", async () => {
    const dir = path.join(tmpDir, "daily-write")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, level: "DEBUG", path: dir, rotate: { kind: "daily" } })
    const logger = Log.create({ service: "test-daily-write" })
    logger.info("hello daily")

    await Bun.sleep(50)
    const content = await fs.readFile(Log.file(), "utf-8")
    expect(content).toContain("hello daily")
  })

  test("appends to existing file on re-init same day", async () => {
    const dir = path.join(tmpDir, "daily-append")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, level: "DEBUG", path: dir, rotate: { kind: "daily" } })
    const logger1 = Log.create({ service: "test-daily-append-1" })
    logger1.info("first message")
    await Bun.sleep(50)

    const filePath = Log.file()
    const contentAfterFirst = await fs.readFile(filePath, "utf-8")
    expect(contentAfterFirst).toContain("first message")

    // re-init same day same dir
    await Log.init({ print: false, level: "DEBUG", path: dir, rotate: { kind: "daily" } })
    const logger2 = Log.create({ service: "test-daily-append-2" })
    logger2.info("second message")
    await Bun.sleep(50)

    const contentAfterSecond = await fs.readFile(Log.file(), "utf-8")
    expect(contentAfterSecond).toContain("second message")
  })
})

describe("Log.file()", () => {
  test("returns non-empty path after startup init", async () => {
    const dir = path.join(tmpDir, "file-path-startup")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, path: dir, rotate: { kind: "startup" } })
    expect(Log.file()).toBeTruthy()
    expect(Log.file()).toContain(dir)
  })

  test("returns non-empty path after daily init", async () => {
    const dir = path.join(tmpDir, "file-path-daily")
    await fs.mkdir(dir, { recursive: true })

    await Log.init({ print: false, path: dir, rotate: { kind: "daily" } })
    expect(Log.file()).toBeTruthy()
    expect(Log.file()).toContain(dir)
  })
})
