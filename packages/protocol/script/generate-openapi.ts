import { SchemaAST } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { format } from "prettier"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"
import { OpenCodeEvent } from "../src/groups/event.js"
import { SessionLogItem } from "../src/groups/session.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

// Effect omits StreamSse data payloads from contentSchema; remove this bridge when it emits the links again.
const payloads = [OpenCodeEvent, SessionLogItem]
const source = stabilizeOpenApi(OpenApi.fromApi(ClientApi.annotate(HttpApi.AdditionalSchemas, payloads)))
payloads.forEach((payload) => {
  const identifier = SchemaAST.resolveIdentifier(payload.ast)
  if (identifier === undefined) throw new Error("SSE payload schema is missing an identifier")
  const envelopeName = `${identifier}Encoded`
  const envelope = source.components.schemas[envelopeName]
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope) ||
    !("type" in envelope) ||
    envelope.type !== "string" ||
    !("contentMediaType" in envelope) ||
    envelope.contentMediaType !== "application/json"
  ) {
    throw new Error(`Missing encoded OpenAPI component: ${envelopeName}`)
  }
  if ("contentSchema" in envelope) return
  source.components.schemas[envelopeName] = {
    ...envelope,
    contentSchema: { $ref: `#/components/schemas/${identifier}` },
  }
})
const document = await format(JSON.stringify(source, null, 2), {
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
