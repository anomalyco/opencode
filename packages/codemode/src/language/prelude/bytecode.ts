import { parse } from "acorn"
import { Source } from "../runtime/source.js"
import { hash } from "../snapshot/snapshot.js"
import { type Code, codeFromJson, type CodeJson, codeToJson } from "../code.js"
import { compileSource } from "../compiler/compile.js"
import saved from "./bytecode.json" with { type: "json" }

/** A built-in source's bytecode as `script/prelude.ts` saves it, with a hash of the text it was compiled from. */
export type SavedCodes = { readonly text: string; readonly codes: ReadonlyArray<CodeJson> }

/**
 * A built-in source's bytecode (the prelude's, the VM's internal helpers'), made once per process: from the bytecode
 * compiled ahead of time when it was compiled from this text, so the process neither parses nor compiles it until
 * something asks for its nodes (an error's site, a saved state's); compiled now otherwise. A test checks the saved
 * bytecode is what the compiler makes. Its top-level functions start at a line's start; they are found by name.
 */
export const builtinCodes = (id: string, text: string) => {
  const tree = () => parse(text, { ecmaVersion: "latest", sourceType: "script" })
  const ahead = (saved as { readonly [id: string]: SavedCodes | undefined })[id]
  const lazy = new Source(id, text, tree)
  const codes =
    ahead?.text === hash(text)
      ? ahead.codes.map((code) => codeFromJson(code, lazy))
      : compileSource(new Source(id, text, tree()), { internal: true })
  const byName = new Map<string, Code>()
  // A top-level function comes before the functions nested in it, in pre-order.
  for (const [, name] of text.matchAll(/^(?:async )?function\*? ?([\w$]+)/gm)) {
    byName.set(name!, codes.find((made) => made.index > 0 && made.name === name)!)
  }
  return { codes, byName }
}

/** What `script/prelude.ts` saves for a built-in source. */
export const saveCodes = (text: string, codes: ReadonlyArray<Code>): SavedCodes => ({
  text: hash(text),
  codes: codes.map(codeToJson),
})
