// `opencode acp --attach <server>` attaches the ACP bridge to a running opencode
// server instead of starting an embedded one. Sessions created through the
// bridge must land on the target server — that is the point of the flag:
// editor-driven sessions become visible (and stream events) to every other
// client of that server, instead of living in a private per-process server
// that only shares the database.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient as createJsonRpcAcpClient } from "./acp-test-client"
import { initialize, newSession, verifierConfig } from "./helpers"

describe("opencode acp --attach (attach to a running server)", () => {
  cliIt.live(
    "creates sessions on the target server, not an embedded one",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) }
        const server = yield* opencode.serve({ env })

        // Spawn the ACP bridge as a client of the running server.
        const acp = createJsonRpcAcpClient(yield* opencode.acp({ env, extraArgs: ["--attach", server.url] }))
        yield* initialize(acp)
        const session = yield* newSession(acp, home)

        // Third-party view: the target server must list the session created
        // through the bridge. If --attach were ignored, the session would land
        // in the bridge's own embedded server and this list would miss it.
        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/api/session?directory=${encodeURIComponent(home)}`)
        expect(res.status).toBe(200)
        const body = yield* res.json
        expect(JSON.stringify(body)).toContain(session.sessionId)
      }),
    60_000,
  )
})
