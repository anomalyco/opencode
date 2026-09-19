import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { expectOk } from "./acp-test-client"
import { createAcpClient, initializeV2, newSession, verifierConfig } from "./helpers"

describe("opencode acp v2 prompt lifecycle subprocess", () => {
  cliIt.live(
    "negotiates v2 and acknowledges a prompt with an empty result plus state_update",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient(
          { opencode },
          {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            OPENCODE_EXPERIMENTAL_ACP_V2: "1",
          },
        )

        const initialized = yield* initializeV2(acp)
        expect(initialized.protocolVersion).toBe(2)
        expect((initialized as unknown as { info: { name: string } }).info.name).toBe("OpenCode")
        expect((initialized as unknown as { capabilities: { session: object } }).capabilities.session).toBeDefined()

        const session = yield* newSession(acp, home)
        const result = expectOk(
          yield* acp.request<{ stopReason?: string }>("session/prompt", {
            sessionId: session.sessionId,
            messageId: "msg_1",
            prompt: [{ type: "text", text: "say hi" }],
          }),
        )
        // v2 acceptance: the prompt response is empty; the turn has not completed yet.
        expect(result.stopReason).toBeUndefined()

        // Foreground progress now flows as session/update notifications. The running
        // state_update is emitted as soon as the prompt is admitted.
        const update = yield* acp.waitForNotification<{ update: { sessionUpdate: string; state?: string } }>(
          "session/update",
          (params) => params.update?.sessionUpdate === "state_update",
        )
        expect(update.params!.update.sessionUpdate).toBe("state_update")
      }),
    60_000,
  )

  cliIt.live(
    "falls back to protocolVersion 1 when the flag is off even if the client requests v2",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient({ opencode })
        const initialized = yield* initializeV2(acp)
        // Without OPENCODE_EXPERIMENTAL_ACP_V2, the agent answers with v1.
        expect(initialized.protocolVersion).toBe(1)
        expect((initialized as unknown as { agentInfo?: unknown }).agentInfo).toBeDefined()
      }),
    60_000,
  )
})
