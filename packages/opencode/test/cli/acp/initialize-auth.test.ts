import { describe, expect } from "bun:test"
import type { AuthenticateResponse, InitializeResponse } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient, expectErrorCode, initialize } from "./helpers"

describe("opencode acp initialize/auth subprocess", () => {
  cliIt.live(
    "initialize responds with capabilities",
    ({ opencode }) =>
      Effect.gen(function* () {
        const initialized = yield* initialize(yield* createAcpClient({ opencode }))

        expect(initialized.protocolVersion).toBe(1)
        expect(initialized.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true)
        expect(initialized.agentCapabilities?.promptCapabilities?.image).toBe(true)
        expect(initialized.agentCapabilities?.mcpCapabilities?.http).toBe(true)
        expect(initialized.agentCapabilities?.mcpCapabilities?.sse).toBe(true)
        expect(initialized.agentCapabilities?.loadSession).toBe(true)
        expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})
        expect(initialized.agentCapabilities?.sessionCapabilities?.fork).toEqual({})
        expect(initialized.agentCapabilities?.sessionCapabilities?.list).toEqual({})
        expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
        expect(initialized.agentInfo?.name).toBe("OpenCode")
      }),
    60_000,
  )

  cliIt.live(
    "auth negotiation is explicit and safe",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient({ opencode })
        const initialized = yield* initialize(acp)

        expect(initialized.authMethods?.[0]?.id).toBe("opencode-login")
        expect(initialized.authMethods?.[0]?._meta?.["terminal-auth"]).toBeDefined()
        expect(yield* acp.request<AuthenticateResponse>("authenticate", { methodId: "opencode-login" })).toMatchObject({
          result: {},
        })

        const rejected = yield* acp.request<AuthenticateResponse>("authenticate", { methodId: "missing-auth-method" })
        expectErrorCode(rejected.error, -32602)
        expect(JSON.stringify(rejected.error)).not.toContain(process.env.OPENCODE_AUTH_CONTENT ?? "not-present")
      }),
    60_000,
  )

  cliIt.live(
    "initialize without terminal-auth metadata keeps auth command implicit",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpClient({ opencode })
        const initialized = yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })

        expect(initialized.result?.authMethods?.[0]?.id).toBe("opencode-login")
        expect(initialized.result?.authMethods?.[0]?._meta?.["terminal-auth"]).toBeUndefined()
      }),
    60_000,
  )
})
