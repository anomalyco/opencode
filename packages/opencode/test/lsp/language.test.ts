import { describe, expect, test } from "bun:test"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

describe("LANGUAGE_EXTENSIONS", () => {
  test("maps C++ extensions, including module interface files, to the cpp filetype", () => {
    for (const ext of [".cpp", ".cxx", ".cc", ".c++", ".cppm"]) {
      expect(LANGUAGE_EXTENSIONS[ext]).toBe("cpp")
    }
  })
})
