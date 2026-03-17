import { describe, it, expect } from "bun:test"
import { Config } from "../../src/config/config"
import { LSP } from "../../src/lsp/index"

describe("LSP min_severity", () => {
  describe("Config schema", () => {
    it("accepts min_severity per-LSP", () => {
      const testConfig = {
        lsp: {
          typescript: {
            min_severity: 2
          }
        }
      }
      
      const result = Config.Info.safeParse(testConfig)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.lsp).toBeDefined()
        expect((result.data.lsp as any).typescript.min_severity).toBe(2)
      }
    })
    
    it("accepts min_severity with command and extensions", () => {
      const testConfig = {
        lsp: {
          markdownlint: {
            command: ["markdownlint-lsp"],
            extensions: [".md"],
            min_severity: 3
          }
        }
      }
      
      const result = Config.Info.safeParse(testConfig)
      expect(result.success).toBe(true)
    })
    
    it("rejects min_severity > 4", () => {
      const testConfig = {
        lsp: {
          typescript: {
            min_severity: 5
          }
        }
      }
      
      const result = Config.Info.safeParse(testConfig)
      expect(result.success).toBe(false)
    })
    
    it("rejects min_severity < 1", () => {
      const testConfig = {
        lsp: {
          typescript: {
            min_severity: 0
          }
        }
      }
      
      const result = Config.Info.safeParse(testConfig)
      expect(result.success).toBe(false)
    })
    
    it("accepts non-integer min_severity as invalid", () => {
      const testConfig = {
        lsp: {
          typescript: {
            min_severity: 1.5
          }
        }
      }
      
      const result = Config.Info.safeParse(testConfig)
      expect(result.success).toBe(false)
    })
  })
  
  describe("LSP.Diagnostic.filter", () => {
    const diagnostics = [
      { severity: 1, message: "Error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
      { severity: 2, message: "Warning", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } } },
      { severity: 3, message: "Info", range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } } },
      { severity: 4, message: "Hint", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } } },
    ] as any
    
    it("returns only errors when min=1", () => {
      const filtered = LSP.Diagnostic.filter(diagnostics, 1)
      expect(filtered.length).toBe(1)
      expect(filtered[0].message).toBe("Error")
    })
    
    it("returns errors and warnings when min=2", () => {
      const filtered = LSP.Diagnostic.filter(diagnostics, 2)
      expect(filtered.length).toBe(2)
      expect(filtered.map(d => d.message)).toEqual(["Error", "Warning"])
    })
    
    it("returns errors, warnings, and info when min=3", () => {
      const filtered = LSP.Diagnostic.filter(diagnostics, 3)
      expect(filtered.length).toBe(3)
    })
    
    it("returns all diagnostics when min=4", () => {
      const filtered = LSP.Diagnostic.filter(diagnostics, 4)
      expect(filtered.length).toBe(4)
    })
    
    it("handles diagnostics without severity (defaults to 1)", () => {
      const noSeverity = [
        { message: "No severity", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
      ] as any
      
      const filtered = LSP.Diagnostic.filter(noSeverity, 1)
      expect(filtered.length).toBe(1)
    })
  })
})
