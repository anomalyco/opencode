import assert from "node:assert/strict"
import { ClientError, OpenCode } from "@opencode/client/promise"
import { createMiniConnection } from "../../src/mini"

const endpoint = { url: process.argv[2]! }
const connection = createMiniConnection({ endpoint, reconnect: async () => endpoint })
const replacement = await connection.reconnect?.(new AbortController().signal)
if (!replacement) throw new Error("Expected a replacement client")

const timeout = (error: unknown) =>
  error instanceof ClientError &&
  error.reason === "Transport" &&
  error.cause instanceof Error &&
  error.cause.name === "TimeoutError"

await Promise.all([
  connection.sdk.session.wait({ sessionID: "ses_initial" }),
  replacement.session.wait({ sessionID: "ses_reconnected" }),
  assert.rejects(OpenCode.make({ baseUrl: endpoint.url }).session.wait({ sessionID: "ses_control" }), timeout),
  assert.rejects(
    connection.sdk.session.wait({ sessionID: "ses_cancelled" }, { signal: AbortSignal.timeout(100) }),
    timeout,
  ),
])
