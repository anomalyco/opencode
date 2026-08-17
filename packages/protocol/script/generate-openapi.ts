import { OpenApi } from "effect/unstable/httpapi"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"

const document = JSON.stringify(OpenApi.fromApi(ClientApi), null, 2) + "\n"
const target = fileURLToPath(new URL("../openapi.json", import.meta.url))

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== document) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, document)
