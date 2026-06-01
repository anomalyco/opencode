import { describe, expect, test, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"

const spawnMock = mock()

const defaultSpawnImpl = () => ({ on: (_event: string, _cb: () => void) => {} })

mock.module("child_process", () => ({ spawn: spawnMock }))

let handleSmartSelection: (text: string) => void

// ─── helpers ───────────────────────────────────────────────────────────

let tmpDir: string
let tmpFile: string

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!

beforeAll(async () => {
  const mod = await import("../../../src/cli/cmd/tui/util/smart-selection")
  handleSmartSelection = mod.handleSmartSelection
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "opencode-test-"))
  tmpFile = path.join(tmpDir, "test.txt")
  writeFileSync(tmpFile, "hello")
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "darwin" })
  spawnMock.mockClear()
  spawnMock.mockImplementation(defaultSpawnImpl)
})

afterEach(() => {
  Object.defineProperty(process, "platform", realPlatform)
})

// ─── tests ─────────────────────────────────────────────────────────────

describe("smart-selection", () => {
  // ─── URL detection ───────────────────────────────────────────────────
  describe("URL handling", () => {
    test("opens https URL in browser", () => {
      handleSmartSelection("https://example.com/path")
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual(["https://example.com/path"])
    })

    test("opens http URL in browser", () => {
      handleSmartSelection("http://example.com")
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual(["http://example.com"])
    })

    test("opens URL with query string and hash", () => {
      handleSmartSelection("https://example.com/path?a=1&b=2#section")
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][1][0]).toBe("https://example.com/path?a=1&b=2#section")
    })

    test("opens URL after trim (leading/trailing spaces)", () => {
      handleSmartSelection("  https://example.com  ")
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][1]).toEqual(["https://example.com"])
    })

    test("does not open URL with leading text", () => {
      handleSmartSelection("visit https://example.com please")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open URL in markdown link format", () => {
      handleSmartSelection("[link](https://example.com)")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open ftp scheme", () => {
      handleSmartSelection("ftp://example.com")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open other scheme", () => {
      handleSmartSelection("file:///etc/passwd")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open for plain non-URL text", () => {
      handleSmartSelection("/some/file/path")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open for URL-like text in multiple lines", () => {
      handleSmartSelection("line1\nhttps://example.com\nline3")
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  // ─── path detection ──────────────────────────────────────────────────
  describe("path handling", () => {
    test("opens existing directory", () => {
      handleSmartSelection(os.tmpdir())
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual([os.tmpdir()])
    })

    test("opens existing directory created in test", () => {
      handleSmartSelection(tmpDir)
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual([tmpDir])
    })

    test("reveals existing file in Finder", () => {
      handleSmartSelection(tmpFile)
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual(["-R", tmpFile])
    })

    test("reveals current test file in Finder", () => {
      handleSmartSelection(__filename)
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual(["-R", __filename])
    })

    test("does nothing for non-existing path", () => {
      const nonexistent = path.join(os.tmpdir(), "opencode-test-nonexistent-" + Date.now())
      handleSmartSelection(nonexistent)
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  // ─── tilde expansion ─────────────────────────────────────────────────
  describe("tilde expansion", () => {
    test("expands ~ to home directory and opens it", () => {
      handleSmartSelection("~")
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual([os.homedir()])
    })
  })

  // ─── relative path resolution ────────────────────────────────────────
  describe("relative path resolution", () => {
    test("resolves relative path to an existing directory", () => {
      const relDir = path.relative(process.cwd(), os.tmpdir())
      handleSmartSelection(relDir)
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe("open")
      expect(spawnMock.mock.calls[0][1]).toEqual([path.resolve(process.cwd(), relDir)])
    })
  })

  // ─── spawn parameter assertions ──────────────────────────────────────
  describe("spawn parameters", () => {
    test("URL spawns with open [url] - array form", () => {
      handleSmartSelection("https://example.com")
      const callArgs = spawnMock.mock.calls[0]
      expect(callArgs[0]).toBe("open")
      expect(callArgs[1]).toBeArray()
      expect(callArgs[1].length).toBe(1)
      expect(callArgs[1][0]).toBe("https://example.com")
    })

    test("directory spawns with open [dir] - array form", () => {
      handleSmartSelection(tmpDir)
      const callArgs = spawnMock.mock.calls[0]
      expect(callArgs[0]).toBe("open")
      expect(callArgs[1]).toBeArray()
      expect(callArgs[1].length).toBe(1)
      expect(callArgs[1][0]).toBe(tmpDir)
    })

    test("file spawns with open [-R, file] - array form", () => {
      handleSmartSelection(tmpFile)
      const callArgs = spawnMock.mock.calls[0]
      expect(callArgs[0]).toBe("open")
      expect(callArgs[1]).toBeArray()
      expect(callArgs[1].length).toBe(2)
      expect(callArgs[1][0]).toBe("-R")
      expect(callArgs[1][1]).toBe(tmpFile)
    })
  })

  // ─── non-macos no-op ─────────────────────────────────────────────────
  describe("non-macos no-op", () => {
    test("does not open URL on linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      handleSmartSelection("https://example.com")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open path on linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      handleSmartSelection(tmpFile)
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does not open URL on win32", () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      handleSmartSelection("https://example.com")
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  // ─── long text fast no-op ────────────────────────────────────────────
  describe("long text fast no-op", () => {
    test("does nothing for text > 2000 chars", () => {
      const longText = "x".repeat(2001)
      handleSmartSelection(longText)
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does nothing for 2001 chars URL-shaped text", () => {
      const longUrl = "https://example.com/" + "a".repeat(2001)
      handleSmartSelection(longUrl)
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("handles text at the boundary (2000 chars)", () => {
      const url2000 = "https://example.com/" + "a".repeat(1980)
      expect(url2000.length).toBe(2000)
      handleSmartSelection(url2000)
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })
  })

  // ─── empty text ──────────────────────────────────────────────────────
  describe("empty text", () => {
    test("does nothing for empty string", () => {
      handleSmartSelection("")
      expect(spawnMock).not.toHaveBeenCalled()
    })

    test("does nothing for whitespace-only string", () => {
      handleSmartSelection("   \n\t  ")
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  // ─── errors handled silently ─────────────────────────────────────────
  describe("error handling", () => {
    test("does not throw for synchronous spawn failure", () => {
      spawnMock.mockImplementation(() => {
        throw new Error("spawn failed")
      })
      expect(() => handleSmartSelection("https://example.com")).not.toThrow()
    })

    test("registers error listener and does not throw on async error", () => {
      const onImpl = mock()
      spawnMock.mockImplementation(() => ({ on: onImpl }))
      expect(() => handleSmartSelection("https://example.com")).not.toThrow()
      expect(onImpl).toHaveBeenCalledTimes(1)
      expect(onImpl.mock.calls[0][0]).toBe("error")
    })
  })
})
