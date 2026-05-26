import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { PatentDocument } from "../../src/patent/document"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import * as path from "node:path"

describe("PatentDocument", () => {
  test("convertToMarkdown reads txt files", async () => {
    await Effect.gen(function* () {
      const svc = yield* PatentDocument.Service
      const test = yield* TestInstance
      const filePath = path.join(test.directory, "test.txt")
      yield* Effect.tryPromise({
        try: () => Bun.write(filePath, "Hello, World!"),
        catch: (cause) => cause,
      })
      const result = yield* svc.convertToMarkdown(filePath)
      expect(result.text).toBe("Hello, World!")
      expect(result.format).toBe("plain")
    })
      .pipe(Effect.provide(PatentDocument.layer))
      .pipe(withTmpdirInstance())
      .pipe(Effect.scoped)
      .pipe(Effect.runPromise)
  })

  test("supportedFormats returns expected list", async () => {
    await Effect.gen(function* () {
      const svc = yield* PatentDocument.Service
      const formats = yield* svc.supportedFormats()
      expect(formats).toContain(".txt")
      expect(formats).toContain(".md")
      expect(formats).toContain(".docx")
      expect(formats).toContain(".pdf")
    })
      .pipe(Effect.provide(PatentDocument.layer))
      .pipe(Effect.runPromise)
  })

  test("convertToMarkdown fails on unsupported format", async () => {
    await Effect.gen(function* () {
      const svc = yield* PatentDocument.Service
      const test = yield* TestInstance
      const filePath = path.join(test.directory, "test.xyz")
      yield* Effect.tryPromise({
        try: () => Bun.write(filePath, "content"),
        catch: (cause) => cause,
      })
      const result = yield* svc.convertToMarkdown(filePath).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    })
      .pipe(Effect.provide(PatentDocument.layer))
      .pipe(withTmpdirInstance())
      .pipe(Effect.scoped)
      .pipe(Effect.runPromise)
  })
})