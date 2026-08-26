import { Schema } from "effect"
import { format } from "prettier"
import { Info, SchemaURL } from "../src/config/schema"

const target = process.argv[2]
if (!target) throw new Error("A schema output path is required")

const document = Schema.toJsonSchemaDocument(Info)
const content = await format(
  JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SchemaURL,
    ...document.schema,
    ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
  }),
  { parser: "json", printWidth: 120 },
)

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== content) {
    console.error("Generated CLI config schema is stale. Run `bun run generate` from packages/www.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, content)
