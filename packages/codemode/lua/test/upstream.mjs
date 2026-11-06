import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { runLua } from "../index.js"

const response = await fetch(
  process.argv[2] ? pathToFileURL(process.argv[2]) : "https://www.lua.org/tests/lua5.1-tests.tar.gz",
)
if (!response.ok) throw new Error(`Lua test suite: ${response.status} ${response.statusText}`)
const bytes = await response.arrayBuffer()
assert.equal(
  Bun.SHA256.hash(bytes, "hex"),
  "49e4ca6561f82ea605908c5041ab5fad66ed9930fa0686675bd51b02767f18ad",
  "unexpected Lua test archive",
)
const names = ["vararg", "pm", "locals", "math"]
const files = await new Bun.Archive(bytes).files(`lua5.1-tests/{${names.join(",")}}.lua`)

// Run source unchanged in fresh globals. locals.lua also returns a closure;
// check its first result in Lua rather than exporting that closure to JS.
for (const name of names) {
  const source = Buffer.from(await files.get(`lua5.1-tests/${name}.lua`).arrayBuffer()).toString("latin1")
  const prefix = name === "math" ? "_soft = true\n" : ""
  const result = runLua(
    name === "locals" ? `local function suite()\n${source}\nend\nreturn (suite())` : prefix + source,
  )
  assert.deepEqual(result, name === "locals" ? [5] : [])
  console.log(`PASS ${name}.lua${prefix ? " (_soft)" : ""}`)
}
