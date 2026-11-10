#!/usr/bin/env bun

// Compiles the built-in sources (the prelude, the VM's internal helpers) ahead of time into src/vm/prelude/bytecode.json,
// which a process loads instead of parsing and compiling them (see src/vm/prelude/bytecode.ts). Run it after changing
// either source or the compiler; test/vm/prelude-bytecode.test.ts fails until then.

import { parse } from "acorn"
import { Source } from "../src/vm/runtime/source.js"
import { saveCodes } from "../src/vm/prelude/bytecode.js"
import { code } from "../src/vm/prelude/source.js"
import { compileSource } from "../src/vm/compiler/compile.js"
import { INTERNAL_SOURCE } from "../src/vm/internal-prelude.js"

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
  await Bun.write(new URL("../src/vm/prelude/bytecode.json", import.meta.url), `${JSON.stringify(compileBuiltins())}\n`)
}
