// Writes crates/plugin-abi/schema/v2.json: the JSON Schema of plugin contract 2.0, generated from the Rust types of
// `opencode_plugin_abi::v2` by its `schema` example (synthesis 4.6: "the schema is generated from the Rust types").
import { format, resolveConfig } from "prettier"

const root = new URL("../..", import.meta.url).pathname
const proc = Bun.spawnSync(
  ["cargo", "run", "-q", "-p", "opencode-plugin-abi", "--features", "schema", "--example", "schema"],
  { cwd: root, stdout: "pipe", stderr: "inherit" },
)
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
const file = new URL("../../crates/plugin-abi/schema/v2.json", import.meta.url).pathname
const text = proc.stdout.toString()
await Bun.write(file, await format(text, { ...(await resolveConfig(file)), parser: "json" }))
console.log(`plugin-schema: ${Object.keys(JSON.parse(text).$defs).length} definitions`)
