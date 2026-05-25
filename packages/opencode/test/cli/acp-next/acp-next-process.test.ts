import { describe, expect } from "bun:test"
import type {
  AuthenticateResponse,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"
import { createAcpClient, expectOk, selectConfigOption } from "../acp/acp-test-client"

describe("opencode acp-next (subprocess)", () => {
  cliIt.live(
    "responds to initialize behind OPENCODE_ACP_NEXT",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp({ env: { OPENCODE_ACP_NEXT: "1" } }))
        const initialized = expectOk(
          yield* acp.request<InitializeResponse>("initialize", {
            protocolVersion: 1,
            clientCapabilities: { _meta: { "terminal-auth": true } },
          }),
        )

        expect(initialized.protocolVersion).toBe(1)
        expect(initialized.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true)
        expect(initialized.agentCapabilities?.promptCapabilities?.image).toBe(true)
        expect(initialized.agentCapabilities?.mcpCapabilities?.http).toBe(true)
        expect(initialized.agentCapabilities?.mcpCapabilities?.sse).toBe(true)
        expect(initialized.agentCapabilities?.loadSession).toBe(true)
        expect(initialized.agentCapabilities?.sessionCapabilities).toBeUndefined()
        expect(initialized.agentInfo?.name).toBe("OpenCode")
        expect(initialized.authMethods?.[0]?.id).toBe("opencode-login")
        expect(initialized.authMethods?.[0]?._meta?.["terminal-auth"]).toBeDefined()
      }),
    60_000,
  )

  cliIt.live(
    "authenticate succeeds for the advertised auth method and rejects unknown methods safely",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp({ env: { OPENCODE_ACP_NEXT: "1" } }))
        const initialized = expectOk(yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 }))
        const methodId = initialized.authMethods?.[0]?.id
        expect(methodId).toBe("opencode-login")

        expectOk(yield* acp.request<AuthenticateResponse>("authenticate", { methodId }))

        const rejected = yield* acp.request<AuthenticateResponse>("authenticate", { methodId: "missing-auth-method" })
        expect(errorCode(rejected.error)).toBe(-32602)
      }),
    60_000,
  )

  cliIt.live(
    "creates and loads sessions behind OPENCODE_ACP_NEXT",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_ACP_NEXT: "1",
              OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(llm.url)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })

        const session = expectOk(
          yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }),
        )
        expect(typeof session.sessionId).toBe("string")
        expect(selectConfigOption(session.configOptions, "model")?.category).toBe("model")

        const update = yield* acp.waitForNotification<SessionNotification>(
          "session/update",
          (params) =>
            params.sessionId === session.sessionId &&
            params.update.sessionUpdate === "available_commands_update",
        )
        expect(update.params?.sessionId).toBe(session.sessionId)

        const loaded = expectOk(
          yield* acp.request<LoadSessionResponse>("session/load", {
            cwd: home,
            sessionId: session.sessionId,
            mcpServers: [],
          }),
        )
        expect(selectConfigOption(loaded.configOptions, "model")?.category).toBe("model")

        const prompt = yield* acp.request("session/prompt", {
          sessionId: "ses_missing",
          prompt: [{ type: "text", text: "hello" }],
        })
        expect(errorCode(prompt.error)).toBe(-32601)
      }),
    60_000,
  )

  cliIt.live(
    "exits cleanly when flagged stdin is closed",
    ({ opencode }) =>
      Effect.gen(function* () {
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const acp = yield* opencode.acp({ env: { OPENCODE_ACP_NEXT: "1" } })
            return acp.exited
          }),
        )

        const code = yield* Effect.promise(() => exitedPromise)
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "default unflagged path still uses production ACP",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp())
        const initialized = expectOk(yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 }))

        expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})
        expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
      }),
    60_000,
  )
})

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  if (!("code" in error)) return undefined
  return typeof error.code === "number" ? error.code : undefined
}
