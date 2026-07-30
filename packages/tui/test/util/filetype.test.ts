import { describe, expect, test } from "bun:test"
import { filetype } from "../../src/util/filetype"

describe("util.filetype", () => {
  test("maps filenames to presentation languages", () => {
    expect(filetype("component.tsx")).toBe("typescript")
    expect(filetype("script.js")).toBe("typescript")
    expect(filetype("main.py")).toBe("python")
    expect(filetype("README.unknown")).toBeUndefined()
  })

  test("uses none for missing filenames", () => {
    expect(filetype()).toBe("none")
    expect(filetype("")).toBe("none")
  })

  test("ignores extension casing", () => {
    expect(filetype("COMPONENT.TSX")).toBe("typescript")
    expect(filetype("main.PY")).toBe("python")
    expect(filetype("Program.CS")).toBe("csharp")
    expect(filetype("notes.Md")).toBe("markdown")
  })

  test("matches extensionless names", () => {
    expect(filetype("Makefile")).toBe("makefile")
    expect(filetype("makefile")).toBe("makefile")
    expect(filetype("build/Makefile")).toBe("makefile")
  })

  test("matches compound extensions", () => {
    expect(filetype("index.html.erb")).toBe("erb")
    expect(filetype("views/show.json.erb")).toBe("erb")
    expect(filetype("app.css.erb")).toBe("erb")
  })

  test("prefers the longest matching suffix", () => {
    // ".json.erb" wins over ".erb", and neither is shadowed by ".json"
    expect(filetype("data.json")).toBe("json")
    expect(filetype("data.json.erb")).toBe("erb")
  })

  test("resolves extensions on paths", () => {
    expect(filetype("src/util/filetype.ts")).toBe("typescript")
    expect(filetype("a.b/main.rs")).toBe("rust")
  })

  test("stays undefined for unmapped names", () => {
    expect(filetype("LICENSE")).toBeUndefined()
    expect(filetype("archive.xyz")).toBeUndefined()
  })
})
