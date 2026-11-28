import { describe, expect, test } from "bun:test"
import parsers from "../../src/parsers-config"
import { filetype } from "../../src/util/filetype"

describe("util.filetype", () => {
  test("maps filenames to presentation languages", () => {
    expect(filetype("component.tsx")).toBe("typescript")
    expect(filetype("script.js")).toBe("typescript")
    expect(filetype("main.py")).toBe("python")
    expect(filetype("README.unknown")).toBeUndefined()
  })

  test("maps shell filenames to the registered bash parser", () => {
    const languages = ["script.sh", "script.bash", "script.zsh", "script.ksh"].map(filetype)
    expect(languages).toEqual(["bash", "bash", "bash", "bash"])
    expect(parsers.parsers.some((parser) => languages.every((language) => language === parser.filetype))).toBe(true)
  })

  test("uses none for missing filenames", () => {
    expect(filetype()).toBe("none")
    expect(filetype("")).toBe("none")
  })

  test("pins the swift highlights query to the pinned parser version", () => {
    // The swift highlights query must match the pinned wasm parser, otherwise the
    // query fails to compile (e.g. `main` references nodes like `nil_literal` that
    // 0.7.1 does not know) and swift renders as plain text. See #62867.
    const swift = parsers.parsers.find((parser) => parser.filetype === "swift")
    expect(swift).toBeDefined()
    const version = swift!.wasm.match(/\/releases\/download\/([^/]+)\//)?.[1]
    expect(version).toBeDefined()
    expect(swift!.queries.highlights.length).toBeGreaterThan(0)
    expect(
      swift!.queries.highlights.every(
        (query) =>
          query.includes(`/${version}/`) &&
          !query.includes("/main/") &&
          query.includes("alex-pinkus/tree-sitter-swift"),
      ),
    ).toBe(true)
  })
})
