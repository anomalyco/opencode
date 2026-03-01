import { describe, expect, test } from "bun:test"
import path from "path"
import { getLanguageFromShebang, SHEBANG_PATTERNS } from "../../src/lsp/language"
import { tmpdir } from "../fixture/fixture"

describe("SHEBANG_PATTERNS", () => {
  test("uv run pattern matches", () => {
    const pattern = SHEBANG_PATTERNS.find((p) => p.language === "python" && p.pattern.source.includes("uv"))
    expect(pattern).toBeDefined()
    expect(pattern!.pattern.test("#!/usr/bin/env -S uv run --script")).toBe(true)
    expect(pattern!.pattern.test("#!uv run")).toBe(true)
    expect(pattern!.pattern.test("#!/usr/bin/env uv run")).toBe(true)
  })

  test("python patterns match", () => {
    const patterns = SHEBANG_PATTERNS.filter((p) => p.language === "python")
    expect(patterns.length).toBeGreaterThan(0)

    const pythonPattern = patterns.find((p) => p.pattern.source.includes("python"))
    expect(pythonPattern!.pattern.test("#!/usr/bin/python")).toBe(true)
    expect(pythonPattern!.pattern.test("#!/usr/bin/python3")).toBe(true)
    expect(pythonPattern!.pattern.test("#!/usr/bin/python2")).toBe(true)
    expect(pythonPattern!.pattern.test("#!/usr/bin/env python")).toBe(true)
    expect(pythonPattern!.pattern.test("#!/usr/bin/env python3")).toBe(true)
  })

  test("node patterns match", () => {
    const pattern = SHEBANG_PATTERNS.find((p) => p.language === "javascript" && p.pattern.source.includes("node"))
    expect(pattern).toBeDefined()
    expect(pattern!.pattern.test("#!/usr/bin/node")).toBe(true)
    expect(pattern!.pattern.test("#!/usr/bin/env node")).toBe(true)
  })

  test("bash patterns match", () => {
    const pattern = SHEBANG_PATTERNS.find((p) => p.language === "shellscript" && p.pattern.source.includes("bash"))
    expect(pattern).toBeDefined()
    expect(pattern!.pattern.test("#!/bin/bash")).toBe(true)
    expect(pattern!.pattern.test("#!/usr/bin/env bash")).toBe(true)
  })

  test("deno pattern matches typescript", () => {
    const pattern = SHEBANG_PATTERNS.find((p) => p.language === "typescript" && p.pattern.source.includes("deno"))
    expect(pattern).toBeDefined()
    expect(pattern!.pattern.test("#!/usr/bin/env deno")).toBe(true)
    expect(pattern!.pattern.test("#!/usr/local/bin/deno")).toBe(true)
  })
})

describe("getLanguageFromShebang", () => {
  test("returns python for uv run shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/usr/bin/env -S uv run --script
print("hello")
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("python")
  })

  test("returns python for python3 shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/usr/bin/env python3
print("hello")
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("python")
  })

  test("returns javascript for node shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/usr/bin/env node
console.log("hello")
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("javascript")
  })

  test("returns typescript for deno shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/usr/bin/env deno
console.log("hello")
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("typescript")
  })

  test("returns shellscript for bash shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/bin/bash
echo "hello"
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("shellscript")
  })

  test("returns undefined for file without shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `echo "hello"
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-existent file", async () => {
    const result = await getLanguageFromShebang("/nonexistent/path/to/file")
    expect(result).toBeUndefined()
  })

  test("returns ruby for ruby shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/usr/bin/env ruby
puts "hello"
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("ruby")
  })

  test("returns shellscript for sh shebang", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "script"),
          `#!/bin/sh
echo "hello"
`,
        )
        return path.join(dir, "script")
      },
    })
    const result = await getLanguageFromShebang(tmp.extra)
    expect(result).toBe("shellscript")
  })
})
