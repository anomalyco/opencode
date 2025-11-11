import { describe, expect, test } from "bun:test"
import { convertFromJSON, encode, optimizeForAI } from "@/util/toon"

describe("TOON encoding utilities", () => {
  describe("encode", () => {
    test("encodes simple object", () => {
      const data = { name: "Alice", age: 30 }
      const result = encode(data)
      expect(result).toBeString()
      expect(result.length).toBeGreaterThan(0)
    })

    test("encodes array of objects (primary use case)", () => {
      const data = [
        { id: 1, name: "Alice", role: "developer" },
        { id: 2, name: "Bob", role: "designer" },
        { id: 3, name: "Charlie", role: "manager" },
      ]
      const result = encode(data)
      expect(result).toBeString()
      // TOON should be more compact than JSON for this use case
      const jsonLength = JSON.stringify(data).length
      expect(result.length).toBeLessThan(jsonLength)
    })

    test("encodes nested structures", () => {
      const data = {
        project: "OpenCode",
        files: ["index.ts", "utils.ts"],
        errors: [
          { line: 42, message: "Type error" },
          { line: 89, message: "Undefined variable" },
        ],
      }
      const result = encode(data)
      expect(result).toBeString()
      expect(result.length).toBeGreaterThan(0)
    })

    test("accepts custom options", () => {
      const data = { a: 1, b: 2 }
      const result = encode(data, {
        indent: 0,
        delimiter: ",",
      })
      expect(result).toBeString()
    })

    test("handles empty array", () => {
      const result = encode([])
      expect(result).toBeString()
    })

    test("handles empty object", () => {
      const result = encode({})
      expect(result).toBeString()
    })
  })

  describe("optimizeForAI", () => {
    test("encodes with AI-optimized settings", () => {
      const data = {
        files: ["src/index.ts", "src/utils.ts", "src/types.ts"],
        errors: [
          { line: 42, type: "TypeError", message: "Cannot read property" },
          { line: 89, type: "ReferenceError", message: "Variable undefined" },
        ],
      }
      const result = optimizeForAI(data)
      expect(result).toBeString()
      expect(result.length).toBeGreaterThan(0)
    })

    test("produces compact output for tabular data", () => {
      const data = [
        { id: 1, status: "active", count: 42 },
        { id: 2, status: "inactive", count: 17 },
        { id: 3, status: "active", count: 99 },
      ]
      const toonResult = optimizeForAI(data)
      const jsonResult = JSON.stringify(data, null, 2)

      // TOON should be significantly more compact
      expect(toonResult.length).toBeLessThan(jsonResult.length)
    })
  })

  describe("convertFromJSON", () => {
    test("converts JSON string to TOON", () => {
      const json = JSON.stringify({ name: "Test", value: 123 })
      const result = convertFromJSON(json)
      expect(result).toBeString()
      expect(result.length).toBeGreaterThan(0)
    })

    test("converts JSON array to TOON", () => {
      const json = JSON.stringify([
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ])
      const result = convertFromJSON(json)
      expect(result).toBeString()
    })

    test("throws on invalid JSON", () => {
      expect(() => convertFromJSON("not valid json")).toThrow()
    })
  })

  describe("token efficiency", () => {
    test("demonstrates token savings for structured data", () => {
      const sampleData = [
        {
          file: "src/components/Button.tsx",
          line: 42,
          column: 15,
          severity: "error",
          message: "Type 'string' is not assignable to type 'number'",
        },
        {
          file: "src/utils/helpers.ts",
          line: 89,
          column: 23,
          severity: "warning",
          message: "Unused variable 'temp'",
        },
        {
          file: "src/pages/Home.tsx",
          line: 156,
          column: 8,
          severity: "error",
          message: "Cannot find name 'undefined'",
        },
      ]

      const jsonEncoded = JSON.stringify(sampleData, null, 2)
      const toonEncoded = optimizeForAI(sampleData)

      // Log for visibility during test runs
      console.log("JSON length:", jsonEncoded.length)
      console.log("TOON length:", toonEncoded.length)
      console.log("Reduction:", Math.round(((jsonEncoded.length - toonEncoded.length) / jsonEncoded.length) * 100), "%")

      // TOON should achieve significant reduction (30-60% typical)
      const reduction = (jsonEncoded.length - toonEncoded.length) / jsonEncoded.length
      expect(reduction).toBeGreaterThan(0.2) // At least 20% reduction
    })

    test("token savings increase with more uniform data", () => {
      const uniformData = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        status: i % 2 === 0 ? "active" : "inactive",
        score: Math.floor(Math.random() * 100),
      }))

      const jsonLength = JSON.stringify(uniformData, null, 2).length
      const toonLength = encode(uniformData).length

      console.log("Uniform data - JSON:", jsonLength, "TOON:", toonLength)

      // More uniform data should see better compression
      expect(toonLength).toBeLessThan(jsonLength * 0.6) // At least 40% reduction
    })
  })

  describe("real-world use cases", () => {
    test("file list encoding", () => {
      const fileList = {
        root: "/home/user/project",
        files: [
          { path: "src/index.ts", size: 1234, modified: "2024-01-01" },
          { path: "src/utils.ts", size: 5678, modified: "2024-01-02" },
          { path: "src/types.ts", size: 910, modified: "2024-01-03" },
        ],
      }

      const encoded = optimizeForAI(fileList)
      expect(encoded).toBeString()

      const tokenSavings =
        (JSON.stringify(fileList, null, 2).length - encoded.length) / JSON.stringify(fileList, null, 2).length

      console.log("File list token savings:", Math.round(tokenSavings * 100), "%")
    })

    test("error report encoding", () => {
      const errorReport = {
        errors: [
          { file: "app.ts", line: 42, col: 8, msg: "Type error" },
          { file: "utils.ts", line: 15, col: 12, msg: "Undefined" },
          { file: "index.ts", line: 99, col: 3, msg: "Syntax error" },
        ],
        warnings: [
          { file: "legacy.ts", line: 200, col: 5, msg: "Deprecated API" },
          { file: "test.ts", line: 88, col: 19, msg: "Unused import" },
        ],
      }

      const encoded = optimizeForAI(errorReport)
      expect(encoded).toBeString()

      console.log("Error report TOON output:")
      console.log(encoded)
    })

    test("diff metadata encoding", () => {
      const diffMetadata = [
        { file: "src/a.ts", added: 15, removed: 8, status: "modified" },
        { file: "src/b.ts", added: 42, removed: 0, status: "added" },
        { file: "src/c.ts", added: 0, removed: 123, status: "deleted" },
      ]

      const encoded = optimizeForAI(diffMetadata)
      const json = JSON.stringify(diffMetadata, null, 2)

      console.log("\nDiff metadata comparison:")
      console.log("JSON:", json.length, "chars")
      console.log("TOON:", encoded.length, "chars")
      console.log("Savings:", json.length - encoded.length, "chars")
    })
  })
})
