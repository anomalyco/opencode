import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { WorkspaceID } from "../../src/control-plane/schema"
import { HttpApiProxy } from "../../src/server/routes/instance/httpapi/middleware/proxy"
import { it } from "../lib/effect"

describe("HttpApi workspace proxy", () => {
  it.live("returns 503 when remote workspace is not syncing", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("http://localhost/config"))
      const response = yield* HttpApiProxy.http(
        "http://127.0.0.1:9/unreachable",
        undefined,
        request,
        WorkspaceID.make("ws_not_syncing"),
      )

      expect(response.status).toBe(503)
      const client = HttpServerResponse.toClientResponse(response)
      expect(yield* client.text).toBe("broken sync connection for workspace: ws_not_syncing")
    }),
  )
})
