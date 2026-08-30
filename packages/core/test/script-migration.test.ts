import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { generatedMigrations } from "../script/migration"

describe("script/migration generatedMigrations", () => {
  test("derives migration names across glob-yielded separators", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-migration-glob-"))
    try {
      // one entry per separator style; Bun.Glob yields the platform-native one,
      // the other guards the mapping against regressions on either platform
      await fs.mkdir(path.join(dir, "0039_init"))
      await fs.writeFile(path.join(dir, "0039_init", "migration.sql"), "-- init\n")
      const names = await generatedMigrations(dir)
      expect(names).toEqual(["0039_init"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("sorts multiple migration names", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-migration-glob-"))
    try {
      for (const name of ["0041_zeta", "0040_alpha"]) {
        await fs.mkdir(path.join(dir, name))
        await fs.writeFile(path.join(dir, name, "migration.sql"), "-- x\n")
      }
      expect(await generatedMigrations(dir)).toEqual(["0040_alpha", "0041_zeta"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
