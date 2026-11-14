#!/usr/bin/env bun

// Compiles the built-in sources (the prelude, the VM's internal helpers) ahead of time into src/prelude/bytecode.json,
// which a process loads instead of parsing and compiling them (see src/prelude/bytecode.ts). Run it after changing
// either source or the compiler; test/prelude-bytecode.test.ts fails until then.

import { parse } from "acorn"
import { Source } from "../src/runtime/source.js"
import { saveCodes } from "../src/prelude/bytecode.js"
import { code } from "../src/prelude/source.js"
import { compileSource } from "../src/compiler/compile.js"
import { INTERNAL_SOURCE } from "../src/internal-prelude.js"

export const compileBuiltins = () =>
  Object.fromEntries(
    [
      ["@prelude", code],
      ["@vm-internal", INTERNAL_SOURCE],
    ].map(([id, text]) => {
      const source = new Source(id!, text!, parse(text!, { ecmaVersion: "latest", sourceType: "script" }))
      return [id, saveCodes(text!, compileSource(source, { internal: true }))]
    }),
  )

if (import.meta.main) {
  await Bun.write(new URL("../src/prelude/bytecode.json", import.meta.url), `${JSON.stringify(compileBuiltins())}\n`)
}
