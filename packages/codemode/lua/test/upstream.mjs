import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runLua } from "../index.js"

// Run source unchanged in fresh globals. locals.lua also returns a closure;
// check its first result in Lua rather than exporting that closure to JS.
for (const name of ["vararg", "pm", "locals", "math"]) {
  const source = readFileSync(join(process.argv[2], `${name}.lua`), "latin1")
  const prefix = name === "math" ? "_soft = true\n" : ""
  const result = runLua(
    name === "locals" ? `local function suite()\n${source}\nend\nreturn (suite())` : prefix + source,
  )
  assert.deepEqual(result, name === "locals" ? [5] : [])
  console.log(`PASS ${name}.lua${prefix ? " (_soft)" : ""}`)
}
