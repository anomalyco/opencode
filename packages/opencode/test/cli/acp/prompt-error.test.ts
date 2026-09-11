import { describe, expect } from "bun:test"
import type { PromptResponse } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { expectOk } from "./acp-test-client"
import { createAcpClient, initialize, newSession, verifierConfig } from "./helpers"

describe("opencode acp provider errors subprocess", () => {
  for (const type of ["GoUsageLimitError", "FreeUsageLimitError"]) {
    cliIt.live(
      `returns ${type} after a completed tool without waiting for quota reset`,
      ({ home, llm, opencode }) =>
        Effect.gen(function* () {
          const acp = yield* createAcpClient(
            { opencode },
            {
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                ...verifierConfig(llm.url),
                permission: { bash: "allow" },
              }),
            },
          )
          yield* initialize(acp)
          const session = yield* newSession(acp, home)

          // Go message and order: louiselm-ygtu, OpenCode 1.18.29 Session
          // ses_f841b1a05ffeaLc8MroaF2snhv, proxy log.jsonl:20297 and
          // ~/.local/share/opencode/log/opencode.log:6327 (2026-09-07).
          // HTTP envelope/Retry-After reconstructed from console's zen handler;
          // not captured on the wire. Free quota is a synthetic sibling case.
          const message =
            type === "GoUsageLimitError" ? "5-hour usage limit reached. Resets in 4hr 10min." : "Free usage exceeded"
          yield* llm.tool("bash", { command: "pwd", description: "Print working directory" })
          yield* llm.push({
            type: "http-error",
            status: 429,
            headers: { "retry-after": "15000" },
            body: {
              type: "error",
              error: { type, message },
              metadata: { workspace: "wrk_test", limitName: "5-hour" },
            },
          })

          const response = yield* acp.request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "Print the working directory." }],
          })
          expect(response.result).toBeUndefined()
          expect(response.error).toMatchObject({ code: -32603, message: expect.stringContaining(message) })
          expect(yield* llm.pending).toBe(0)

          yield* llm.text("quota restored")
          const next = expectOk(
            yield* acp.request<PromptResponse>("session/prompt", {
              sessionId: session.sessionId,
              prompt: [{ type: "text", text: "Try again." }],
            }),
          )
          expect(next.stopReason).toBe("end_turn")
        }),
      60_000,
    )
  }

  for (const status of [429, 503]) {
    cliIt.live(
      `still retries transient HTTP ${status} errors`,
      ({ home, llm, opencode }) =>
        Effect.gen(function* () {
          const acp = yield* createAcpClient(
            { opencode },
            { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
          )
          yield* initialize(acp)
          const session = yield* newSession(acp, home)
          yield* llm.push({
            type: "http-error",
            status,
            headers: { "retry-after": "0" },
            body: { error: { type: "RateLimitError", message: "Try again later" } },
          })
          yield* llm.text("recovered")

          const response = expectOk(
            yield* acp.request<PromptResponse>("session/prompt", {
              sessionId: session.sessionId,
              prompt: [{ type: "text", text: "Hello." }],
            }),
          )
          expect(response.stopReason).toBe("end_turn")
          expect(yield* llm.pending).toBe(0)
        }),
      60_000,
    )
  }

  cliIt.live(
    "keeps interactive quota retries for the default CLI client",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push({
          type: "http-error",
          status: 429,
          headers: { "retry-after": "0" },
          body: { error: { type: "GoUsageLimitError", message: "Quota exceeded" } },
        })
        yield* llm.text("recovered after quota reset")

        const result = yield* opencode.run("Hello.", { format: "json" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("recovered after quota reset")
        expect(yield* llm.pending).toBe(0)
      }),
    60_000,
  )
})
