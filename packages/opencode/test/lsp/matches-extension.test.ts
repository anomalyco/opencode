import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp/index"

describe("LSP.matchesExtension", () => {
  describe("files with extensions", () => {
    test("matches exact extension", () => {
      expect(LSP.matchesExtension("file.dockerfile", [".dockerfile", "Dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("file.sh", [".sh", ".bash"])).toBe(true)
    })

    test("matches case-insensitive extension", () => {
      expect(LSP.matchesExtension("file.Dockerfile", [".dockerfile", "Dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("file.DOCKERFILE", [".dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("file.dockerfile", [".Dockerfile"])).toBe(true)
    })

    test("does not match different extension", () => {
      expect(LSP.matchesExtension("file.txt", [".dockerfile"])).toBe(false)
      expect(LSP.matchesExtension("file.sh", [".dockerfile"])).toBe(false)
    })
  })

  describe("files without extensions (like Dockerfile)", () => {
    test("matches basename exactly", () => {
      expect(LSP.matchesExtension("Dockerfile", [".dockerfile", "Dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("Makefile", ["Makefile"])).toBe(true)
    })

    test("matches basename case-insensitively", () => {
      expect(LSP.matchesExtension("dockerfile", [".dockerfile", "Dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("DOCKERFILE", ["Dockerfile"])).toBe(true)
    })

    test("does not match different basename", () => {
      expect(LSP.matchesExtension("README", ["Dockerfile"])).toBe(false)
    })
  })

  describe("empty extensions array", () => {
    test("returns true for any file", () => {
      expect(LSP.matchesExtension("Dockerfile", [])).toBe(true)
      expect(LSP.matchesExtension("file.dockerfile", [])).toBe(true)
      expect(LSP.matchesExtension("anything", [])).toBe(true)
    })
  })

  describe("files with dots in name", () => {
    test("handles files like app.Dockerfile", () => {
      expect(LSP.matchesExtension("app.Dockerfile", [".dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("app.Dockerfile", ["Dockerfile"])).toBe(false)
    })

    test("handles files with multiple dots", () => {
      expect(LSP.matchesExtension("file.tar.gz", [".gz"])).toBe(true)
      expect(LSP.matchesExtension("file.tar.gz", [".tar"])).toBe(false)
      expect(LSP.matchesExtension("file.tar.bz2", [".bz2"])).toBe(true)
    })
  })

  describe("extension without leading dot", () => {
    test("matches file with extension when extension has no dot", () => {
      expect(LSP.matchesExtension("file.dockerfile", ["dockerfile"])).toBe(false)
      expect(LSP.matchesExtension("Dockerfile", ["dockerfile"])).toBe(true)
    })

    test("mixed dot and no-dot extensions", () => {
      expect(LSP.matchesExtension("file.sh", ["sh", ".bash"])).toBe(false)
      expect(LSP.matchesExtension("file.bash", ["sh", ".bash"])).toBe(true)
    })
  })

  describe("absolute paths", () => {
    test("matches extension in absolute path", () => {
      expect(LSP.matchesExtension("/path/to/Dockerfile", ["Dockerfile"])).toBe(true)
      expect(LSP.matchesExtension("/path/to/file.sh", [".sh"])).toBe(true)
      expect(LSP.matchesExtension("/path/to/file.txt", [".sh"])).toBe(false)
    })
  })

  describe("multiple extensions", () => {
    test("returns true if any extension matches", () => {
      expect(LSP.matchesExtension("file.rb", [".js", ".ts", ".rb"])).toBe(true)
      expect(LSP.matchesExtension("file.go", [".js", ".ts", ".rb"])).toBe(false)
    })
  })
})
