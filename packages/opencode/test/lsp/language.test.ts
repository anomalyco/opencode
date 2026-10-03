import { test, expect } from "bun:test"
import { languageId } from "@/lsp/language"

test("languageId resolves known extensions", () => {
  expect(languageId("foo.ts")).toBe("typescript")
  expect(languageId("/proj/src/app.py")).toBe("python")
})

test("languageId resolves extensionless files by basename", () => {
  // Regression for #33372 / #27604: a file literally named "Dockerfile" has no extension,
  // so extname() is empty and it used to resolve to "plaintext".
  expect(languageId("Dockerfile")).toBe("dockerfile")
  expect(languageId("/proj/Dockerfile")).toBe("dockerfile")
})

test("languageId falls back to plaintext for unknown files", () => {
  expect(languageId("notes.unknownext")).toBe("plaintext")
  expect(languageId("randomfile")).toBe("plaintext")
})
