import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { SyntaxValidator } from "@/syntax"

describe("SyntaxValidator.Service", () => {
  it("supports common TypeScript and Python extensions", () => {
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        expect(service.supports("service.ts")).toBe(true)
        expect(service.supports("component.tsx")).toBe(true)
        expect(service.supports("script.js")).toBe(true)
        expect(service.supports("app.py")).toBe(true)
        expect(service.supports("stubs.pyi")).toBe(true)
        expect(service.supports("styles.css")).toBe(false)
        expect(service.supports("data.json")).toBe(false)
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })

  it("validates correct TypeScript code without errors", () => {
    const code = `export interface User {
  id: string
}

export function greet(name: string): string {
  return "Hello, " + name
}
`
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        const result = yield* service.validate("user.ts", code)
        expect(result.valid).toBe(true)
        expect(result.errors.length).toBe(0)
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })

  it("detects syntax errors in broken TypeScript code", () => {
    const brokenCode = `export function greet(name: string): string {
  const missingBrace = true
`
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        const result = yield* service.validate("broken.ts", brokenCode)
        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors[0].message).toContain("expected")
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })

  it("validates correct Python code without errors", () => {
    const code = `def calculate(a: int, b: int) -> int:
    return a + b
`
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        const result = yield* service.validate("math.py", code)
        expect(result.valid).toBe(true)
        expect(result.errors.length).toBe(0)
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })

  it("detects syntax errors in broken Python code", () => {
    const brokenCode = `def broken(
    x = 1
`
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        const result = yield* service.validate("broken.py", brokenCode)
        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors[0].line).toBe(1)
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })

  it("formats readable syntax error reports", () => {
    Effect.runSync(
      Effect.gen(function* () {
        const service = yield* SyntaxValidator.Service
        const report = service.formatReport("broken.ts", [
          { line: 5, column: 12, message: "'}' expected." },
        ])
        expect(report).toContain("Syntax error(s) detected in broken.ts")
        expect(report).toContain("Line 5, Col 12: '}' expected.")
      }).pipe(Effect.provide(SyntaxValidator.layer)),
    )
  })
})
