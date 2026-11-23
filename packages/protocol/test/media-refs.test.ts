import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

// Reads opted into `experimental-media-uri` return stored files as `media:` refs, so the document has to describe them.
test.each([
  ["/api/session/{sessionID}/inbox", "session.inbox.list"],
  ["/api/session/{sessionID}/message", "session.message.list"],
  ["/api/session/{sessionID}/message/{messageID}", "session.message.get"],
])("%s (%s) documents media: file refs", (path, identifier) => {
  const document = OpenApi.fromApi(ClientApi)
  const operation = document.paths[path]?.get
  expect(operation?.operationId).toBe(identifier)
  expect(reachable(document, operation?.responses["200"])).toContain("Prompt.MediaFileAttachment")
})

function reachable(document: OpenApi.OpenAPISpec, root: unknown) {
  const seen = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== "object") return
    Object.entries(node).forEach(([key, value]) => {
      if (key !== "$ref" || typeof value !== "string") return visit(value)
      const name = value.replace("#/components/schemas/", "")
      if (seen.has(name)) return
      seen.add(name)
      visit(document.components.schemas[name])
    })
  }
  visit(root)
  return [...seen]
}
