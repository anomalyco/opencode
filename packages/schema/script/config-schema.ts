import { Schema } from "effect"
import { Config } from "../src/config.js"

const target = process.argv[2]
if (!target) throw new Error("A schema output path is required")

const document = Schema.toJsonSchemaDocument(Config.Info)
const content = `${JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://opencode.ai/v2/config.json",
    ...document.schema,
    ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
  },
  null,
  2,
)}\n`

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== content) {
    console.error("Generated V2 config schema is stale. Run `bun run generate` from services/www.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, content)
