import { describe, test, expect } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import { Global } from "../../src/global"

describe("Global", () => {
  describe("Path properties", () => {
    test("data is a non-empty string path", () => {
      expect(typeof Global.Path.data).toBe("string")
      expect(Global.Path.data.length).toBeGreaterThan(0)
    })

    test("cache is a non-empty string path", () => {
      expect(typeof Global.Path.cache).toBe("string")
      expect(Global.Path.cache.length).toBeGreaterThan(0)
    })

    test("config is a non-empty string path", () => {
      expect(typeof Global.Path.config).toBe("string")
      expect(Global.Path.config.length).toBeGreaterThan(0)
    })

    test("state is a non-empty string path", () => {
      expect(typeof Global.Path.state).toBe("string")
      expect(Global.Path.state.length).toBeGreaterThan(0)
    })

    test("bin is a subdirectory of data", () => {
      expect(Global.Path.bin).toBe(path.join(Global.Path.data, "bin"))
    })

    test("log is a subdirectory of data", () => {
      expect(Global.Path.log).toBe(path.join(Global.Path.data, "log"))
    })

    test("all paths end with 'opencode' segment", () => {
      expect(path.basename(Global.Path.data)).toBe("opencode")
      expect(path.basename(Global.Path.cache)).toBe("opencode")
      expect(path.basename(Global.Path.config)).toBe("opencode")
      expect(path.basename(Global.Path.state)).toBe("opencode")
    })

    test("paths are absolute", () => {
      expect(path.isAbsolute(Global.Path.data)).toBe(true)
      expect(path.isAbsolute(Global.Path.cache)).toBe(true)
      expect(path.isAbsolute(Global.Path.config)).toBe(true)
      expect(path.isAbsolute(Global.Path.state)).toBe(true)
      expect(path.isAbsolute(Global.Path.bin)).toBe(true)
      expect(path.isAbsolute(Global.Path.log)).toBe(true)
    })
  })

  describe("Path.home", () => {
    test("returns OPENCODE_TEST_HOME when set in test environment", () => {
      const testHome = process.env.OPENCODE_TEST_HOME
      if (testHome) {
        expect(Global.Path.home).toBe(testHome)
      }
    })

    test("returns a non-empty string", () => {
      expect(typeof Global.Path.home).toBe("string")
      expect(Global.Path.home.length).toBeGreaterThan(0)
    })

    test("returns an absolute path", () => {
      expect(path.isAbsolute(Global.Path.home)).toBe(true)
    })
  })

  describe("directory creation", () => {
    test("data directory exists", async () => {
      const stat = await fs.stat(Global.Path.data)
      expect(stat.isDirectory()).toBe(true)
    })

    test("config directory exists", async () => {
      const stat = await fs.stat(Global.Path.config)
      expect(stat.isDirectory()).toBe(true)
    })

    test("state directory exists", async () => {
      const stat = await fs.stat(Global.Path.state)
      expect(stat.isDirectory()).toBe(true)
    })

    test("log directory exists", async () => {
      const stat = await fs.stat(Global.Path.log)
      expect(stat.isDirectory()).toBe(true)
    })

    test("bin directory exists", async () => {
      const stat = await fs.stat(Global.Path.bin)
      expect(stat.isDirectory()).toBe(true)
    })
  })

  describe("cache version", () => {
    test("cache directory exists", async () => {
      const stat = await fs.stat(Global.Path.cache)
      expect(stat.isDirectory()).toBe(true)
    })

    test("cache version file exists", async () => {
      const versionFile = path.join(Global.Path.cache, "version")
      const exists = await fs.access(versionFile).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    test("cache version file contains a numeric string", async () => {
      const versionFile = path.join(Global.Path.cache, "version")
      const content = await fs.readFile(versionFile, "utf-8")
      expect(content).toMatch(/^\d+$/)
    })
  })

  describe("XDG integration", () => {
    test("data path uses XDG_DATA_HOME when set", () => {
      const xdgDataHome = process.env["XDG_DATA_HOME"]
      if (xdgDataHome) {
        expect(Global.Path.data).toStartWith(xdgDataHome)
      }
    })

    test("cache path uses XDG_CACHE_HOME when set", () => {
      const xdgCacheHome = process.env["XDG_CACHE_HOME"]
      if (xdgCacheHome) {
        expect(Global.Path.cache).toStartWith(xdgCacheHome)
      }
    })

    test("config path uses XDG_CONFIG_HOME when set", () => {
      const xdgConfigHome = process.env["XDG_CONFIG_HOME"]
      if (xdgConfigHome) {
        expect(Global.Path.config).toStartWith(xdgConfigHome)
      }
    })

    test("state path uses XDG_STATE_HOME when set", () => {
      const xdgStateHome = process.env["XDG_STATE_HOME"]
      if (xdgStateHome) {
        expect(Global.Path.state).toStartWith(xdgStateHome)
      }
    })
  })
})
