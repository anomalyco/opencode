import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { format } from "prettier"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"
import { OpenCodeEvent } from "../src/groups/event.js"
import { SessionLogItem } from "../src/groups/session.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

// Effect documents StreamSse data as a bare JSON string. Link the payload schemas until it emits `contentSchema` again.
const spec = OpenApi.fromApi(ClientApi.annotate(HttpApi.AdditionalSchemas, [OpenCodeEvent, SessionLogItem]))
spec.components.schemas.V2EventEncoded.contentSchema = { $ref: "#/components/schemas/V2Event" }
spec.components.schemas.SessionLogItemEncoded.contentSchema = { $ref: "#/components/schemas/SessionLogItem" }

const document = await format(JSON.stringify(stabilizeOpenApi(spec), null, 2), {
  parser: "json",
  printWidth: 120,
})
const target = fileURLToPath(new URL("../openapi.json", import.meta.url))

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== document) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, document)
