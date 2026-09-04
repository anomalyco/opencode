// Regression test for G1: child/subagent sessions spawned by the `task` tool
// were never registered in the ACP session store, so their `permission.asked`
// events hit `session.tryGet` -> undefined -> early return in
// acp/permission.ts. Under an "ask" ruleset this left the underlying
// Permission.ask Deferred unresolved forever, hanging the whole
// `session/prompt` call. The fix resolves the child session back to its
// registered root ACP session via the SDK's `parentID` chain, so the
// existing `session/request_permission` round trip fires as normal instead
// of the event being silently dropped.
import { describe, expect } from "bun:test"
import type { PromptResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { Duration, Effect } from "effect"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient as createJsonRpcAcpClient } from "./acp-test-client"
import { initialize, newSession, verifierConfig } from "./helpers"

type JsonRpcMessage = {
  readonly jsonrpc: "2.0"
  readonly id?: number
  readonly method?: string
  readonly params?: { sessionId?: string }
  readonly result?: unknown
}

describe("acp child session permission (G1)", () => {
  cliIt.live(
    "child/subagent session edit:ask surfaces session/request_permission for the child session instead of hanging",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const raw = yield* opencode.acp({
          env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...verifierConfig(llm.url), permission: { edit: "ask" } }) },
        })
        const acp = createJsonRpcAcpClient(raw)
        yield* initialize(acp)
        const session = yield* newSession(acp, home)

        yield* llm.tool("task", {
          description: "write a file",
          prompt: "write child-fix-check.txt",
          subagent_type: "general",
        })
        yield* llm.tool("write", { filePath: "child-fix-check.txt", content: "child wrote this" })
        yield* llm.text("child done")
        yield* llm.text("parent done")

        const promptRequestId = 9999
        yield* raw.send({
          jsonrpc: "2.0",
          id: promptRequestId,
          method: "session/prompt",
          params: { sessionId: session.sessionId, prompt: [{ type: "text", text: "delegate to subagent" }] },
        })

        // Manually drive the duplex channel: reply to any incoming
        // session/request_permission with "reject" (simulating a real but
        // permission-unaware client), while watching for the final
        // session/prompt response. Captures the sessionId the server used
        // for the permission request so we can assert it's the child's real
        // id, not the resolved root's.
        const capturedPermissionSessionIds: string[] = []
        const outcome = yield* Effect.gen(function* () {
          while (true) {
            const message = (yield* raw.receive.pipe(Effect.timeout(Duration.seconds(10)))) as JsonRpcMessage
            if (message.method === "session/request_permission" && message.id !== undefined) {
              if (message.params?.sessionId) capturedPermissionSessionIds.push(message.params.sessionId)
              yield* raw.send({
                jsonrpc: "2.0",
                id: message.id,
                result: { outcome: { outcome: "selected", optionId: "reject" } } satisfies RequestPermissionResponse,
              })
              continue
            }
            if (message.id === promptRequestId) return message
          }
        }).pipe(Effect.timeout(Duration.seconds(15)), Effect.exit)

        expect(outcome._tag).toBe("Success")
        if (outcome._tag !== "Success") return
        const response = outcome.value as { result?: PromptResponse }
        expect(response.result?.stopReason).toBeDefined()

        // The permission request must have been raised for the CHILD's own
        // session id (subagent action honestly attributed), not silently
        // dropped and not impersonating the root session.
        expect(capturedPermissionSessionIds.length).toBeGreaterThan(0)
        expect(capturedPermissionSessionIds).not.toContain(session.sessionId)

        const exists = yield* Effect.promise(() => Bun.file(path.join(home, "child-fix-check.txt")).exists())
        expect(exists).toBe(false)
      }),
    30_000,
  )
})
