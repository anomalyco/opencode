import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"

describe("util.log", () => {
  test("defaults log cap to 128MB", () => {
    expect(Log.MAX).toBe(128 * 1024 * 1024)
  })

  test("deletes old logs and trims active log to stay within cap", async () => {
    await using tmp = await tmpdir()
    const old = path.join(tmp.path, "old.log")
    const cur = path.join(tmp.path, "dev.log")
    await fs.writeFile(old, "old!")
    await fs.writeFile(cur, "0123456789")
    await fs.utimes(old, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"))
    await fs.utimes(cur, new Date("2026-03-02T00:00:00Z"), new Date("2026-03-02T00:00:00Z"))

    await Log.trim({
      dir: tmp.path,
      max: 8,
      file: cur,
    })

    expect(await fs.stat(old).catch(() => undefined)).toBeUndefined()
    expect(await fs.readFile(cur, "utf-8")).toBe("23456789")
  })
})
