import { expect } from "bun:test"
import type { InitializeResponse, NewSessionResponse, SessionConfigOption } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import type { CliFixture } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"
import {
  createAcpClient as createJsonRpcAcpClient,
  expectOk,
  flattenSelectOptions,
  selectConfigOption,
  type AcpClient,
} from "./acp-test-client"

export function createAcpClient(input: Pick<CliFixture, "opencode">, env?: Record<string, string>) {
  return Effect.gen(function* () {
    return createJsonRpcAcpClient(yield* input.opencode.acp(env ? { env } : undefined))
  })
}

export function initialize(acp: AcpClient) {
  return Effect.gen(function* () {
    return expectOk(
      yield* acp.request<InitializeResponse>("initialize", {
        protocolVersion: 1,
        clientCapabilities: { _meta: { "terminal-auth": true } },
        clientInfo: { name: "opencode-local-acp", version: "0.1.0" },
      }),
    )
  })
}

export function newSession(acp: AcpClient, cwd: string) {
  return Effect.gen(function* () {
    return expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd, mcpServers: [] }))
  })
}

export function verifierConfig(llmUrl: string, skills?: string) {
  const config = testProviderConfig(llmUrl)
  return {
    ...config,
    model: "test/test-model",
    ...(skills ? { skills: { paths: [skills] } } : {}),
    provider: {
      test: {
        ...config.provider.test,
        models: {
          "test-model": {
            ...config.provider.test.models["test-model"],
            variants: {
              low: {},
              high: {},
            },
          },
          "second-model": {
            ...config.provider.test.models["test-model"],
            id: "second-model",
            name: "Second Test Model",
            variants: {
              medium: {},
              max: {},
            },
          },
        },
      },
    },
  }
}

export function expectErrorCode(error: unknown, code: number) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    expect(error).toEqual({ code })
    return
  }
  expect(error.code).toBe(code)
}

export function expectSelectOption(options: SessionConfigOption[] | null | undefined, id: string) {
  const option = selectConfigOption(options, id)
  expect(option).toBeDefined()
  return option!
}

export function expectAlternateValue(option: ReturnType<typeof expectSelectOption>) {
  const value = flattenSelectOptions(option).find((item) => item.value !== option.currentValue)?.value
  expect(value).toBeDefined()
  return value!
}

export const verifierSkill = `---
name: verifier-skill
description: Verifier compatibility skill.
---

# Verifier Skill
`
