import { describe, expect, test } from "bun:test"
import { compileBuiltins } from "../../script/prelude.js"
import saved from "../../src/vm/prelude/bytecode.json" with { type: "json" }
import { compiledPrelude } from "../../src/vm/prelude/prelude.js"
import { hashOf } from "../../src/vm/code.js"
import { getInternalPrelude } from "../../src/vm/internal-prelude.js"
import { runProgram } from "./run.js"

// The built-in sources are compiled ahead of time (script/prelude.ts); a process loads that bytecode instead.

describe("precompiled built-ins", () => {
  test("the saved bytecode is what the compiler makes now: run `bun run script/prelude.ts` after a change", () => {
    expect(JSON.parse(JSON.stringify(compileBuiltins()))).toEqual(saved)
  })

  test("are loaded without parsing their sources, and have the compiled bytecode's hash", async () => {
    const fresh = compileBuiltins()
    for (const [built, id] of [
      [compiledPrelude(), "@prelude"],
      [getInternalPrelude(), "@vm-internal"],
    ] as const) {
      const code = built.codes[0]!
      expect(hashOf(built.codes)).toBe(code.source.hash)
      expect(code.source).toEqual(fresh[id]!.codes[0]!.source as never)
    }
    // A fresh process runs a program that calls into the prelude, and its source is still unparsed.
    const script = `
      import { runProgram } from "${import.meta.dir}/run.js"
      import { compiledPrelude } from "${import.meta.dir}/../../src/vm/prelude/prelude.js"
      const result = runProgram("return [3, 1, 2].map((x) => x * 2).sort((a, b) => a - b)")
      console.log(JSON.stringify([result.ok && result.value, typeof compiledPrelude().codes[0].sourceObj.tree]))`
    const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "inherit" })
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual([[2, 4, 6], "function"])
    expect(await child.exited).toBe(0)
  })

  test("a failure inside the prelude parses its source for the site, and is located at the program's call", () => {
    const result = runProgram(`const xs = [1, 2]\nreturn xs.map((x) => x.y.z)`)
    expect(result).toMatchObject({ ok: false, error: { location: { line: 2, column: 22 } } })
  })
})
