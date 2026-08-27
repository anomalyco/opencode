import { describe, expect, test } from "bun:test"
import { javaVersion } from "../../src/lsp/jdtls-version"

describe("lsp.jdtls java version parsing", () => {
  test("parses vanilla three-component versions", () => {
    expect(javaVersion('openjdk version "21.0.3" 2024-04-16')).toBe(21)
  })

  test("parses RHEL four-component build strings (#45569)", () => {
    const stderr = [
      'openjdk version "25.0.4.1" 2026-08-18 LTS',
      "OpenJDK Runtime Environment (Red_Hat-25.0.4.1.1-1) (build 25.0.4.1+1-LTS)",
      "OpenJDK 64-Bit Server VM (Red_Hat-25.0.4.1.1-1) (build 25.0.4.1+1-LTS, mixed mode, sharing)",
    ].join("\n")
    expect(javaVersion(stderr)).toBe(25)
  })

  test("parses bare major versions", () => {
    expect(javaVersion('openjdk version "21" 2023-09-19')).toBe(21)
  })

  test("returns undefined without a quoted version", () => {
    expect(javaVersion("command not found: java")).toBeUndefined()
  })
})
