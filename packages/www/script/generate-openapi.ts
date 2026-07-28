import { fileURLToPath } from "url"

const source = fileURLToPath(new URL("../../protocol/openapi.json", import.meta.url))
const targets = ["../openapi.json", "../public/openapi.json"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
)
const document = await Bun.file(source).text()

if (process.argv.includes("--check")) {
  const stale = (await Promise.all(targets.map((path) => Bun.file(path).text()))).some((value) => value !== document)
  if (stale) {
    console.error("Generated OpenAPI documents are stale. Run `bun run generate` from packages/www.")
    process.exit(1)
  }
  process.exit(0)
}

await Promise.all(targets.map((path) => Bun.write(path, document)))
