import { describe, expect } from "bun:test"
import type {
  CloseSessionResponse,
  InitializeResponse,
  NewSessionResponse,
  ResumeSessionResponse,
  SessionNotification,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"
import {
  createAcpClient,
  expectOk,
  firstAlternateValue,
  flattenSelectOptions,
  selectConfigOption,
} from "./acp-test-client"

describe("opencode acp verifier compatibility baseline", () => {
  cliIt.live(
    "initialize advertises close and resume capabilities",
    ({ opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp())
        const initialized = expectOk(
          yield* acp.request<InitializeResponse>("initialize", {
            protocolVersion: 1,
          }),
        )

        expect(initialized.protocolVersion).toBe(1)
        expect(initialized.agentCapabilities?.sessionCapabilities?.close).toEqual({})
        expect(initialized.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
      }),
    60_000,
  )

  cliIt.live(
    "first session timing diagnostic stays bounded and returns model options",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            },
          }),
        )
        const started = Date.now()
        yield* acp.request<InitializeResponse>("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "opencode-local-acp-baseline", version: "0.1.0" },
        })
        const session = expectOk(
          yield* acp.request<NewSessionResponse>("session/new", {
            cwd: home,
            mcpServers: [],
          }),
        )
        const durationMs = Date.now() - started
        expect(durationMs).toBeLessThan(15_000)

        const model = selectConfigOption(session.configOptions, "model")
        expect(model?.category).toBe("model")
        expect(model?.currentValue).toBe("test/test-model")
        expect(model ? flattenSelectOptions(model).length : 0).toBeGreaterThanOrEqual(2)
      }),
    60_000,
  )

  cliIt.live(
    "warm newSession timing diagnostic stays bounded",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] })

        const started = Date.now()
        const session = expectOk(
          yield* acp.request<NewSessionResponse>("session/new", {
            cwd: home,
            mcpServers: [],
          }),
        )
        const durationMs = Date.now() - started
        expect(durationMs).toBeLessThan(15_000)
        expect(session.sessionId).toBeTruthy()
      }),
    60_000,
  )

  cliIt.live(
    "model switch timing diagnostic updates currentValue",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))
        const model = selectConfigOption(session.configOptions, "model")
        expect(model).toBeDefined()
        const nextModel = model
          ? flattenSelectOptions(model).find((option) => option.value === "test/second-model")?.value
          : undefined
        expect(nextModel).toBe("test/second-model")

        const started = Date.now()
        const updated = expectOk(
          yield* acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
            sessionId: session.sessionId,
            configId: "model",
            value: nextModel,
          }),
        )
        const durationMs = Date.now() - started

        expect(durationMs).toBeLessThan(15_000)
        expect(selectConfigOption(updated.configOptions, "model")?.currentValue).toBe(nextModel)
      }),
    60_000,
  )

  cliIt.live(
    "effort option is listed for variant-capable models and can switch",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))
        const effort = selectConfigOption(session.configOptions, "effort")
        expect(effort?.category).toBe("thought_level")
        const nextEffort = effort ? firstAlternateValue(effort) : undefined
        expect(nextEffort).toBe("high")

        const updated = expectOk(
          yield* acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
            sessionId: session.sessionId,
            configId: "effort",
            value: nextEffort,
          }),
        )

        expect(selectConfigOption(updated.configOptions, "effort")?.currentValue).toBe(nextEffort)
      }),
    60_000,
  )

  cliIt.live(
    "default test provider documents missing effort option when the model has no variants",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(noVariantConfig(llm.url)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))

        expect(selectConfigOption(session.configOptions, "model")?.currentValue).toBe("test/test-model")
        expect(selectConfigOption(session.configOptions, "effort")).toBeUndefined()
      }),
    60_000,
  )

  cliIt.live(
    "skill slash command timing diagnostic appears through available_commands_update",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const skills = path.join(home, "skills")
        yield* Effect.promise(() => mkdir(path.join(skills, "verifier-skill"), { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(skills, "verifier-skill", "SKILL.md"), verifierSkill))
        const acp = createAcpClient(
          yield* opencode.acp({
            env: {
              OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url, skills)),
            },
          }),
        )
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))

        const update = yield* acp.waitForNotification<SessionNotification>(
          "session/update",
          (params) =>
            params.sessionId === session.sessionId &&
            params.update.sessionUpdate === "available_commands_update" &&
            params.update.availableCommands.some((command) => command.name === "verifier-skill"),
        )

        expect(update.params?.sessionId).toBe(session.sessionId)

        const secondSession = expectOk(
          yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }),
        )
        const started = Date.now()
        yield* acp.waitForNotification<SessionNotification>(
          "session/update",
          (params) =>
            params.sessionId === secondSession.sessionId &&
            params.update.sessionUpdate === "available_commands_update" &&
            params.update.availableCommands.some((command) => command.name === "verifier-skill"),
        )
        const durationMs = Date.now() - started
        expect(durationMs).toBeLessThan(15_000)
      }),
    60_000,
  )

  cliIt.live(
    "close request succeeds for a live session",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp())
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))

        expectOk(yield* acp.request<CloseSessionResponse>("session/close", { sessionId: session.sessionId }))
      }),
    60_000,
  )

  cliIt.live(
    "resume request succeeds for a created session",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const acp = createAcpClient(yield* opencode.acp())
        yield* acp.request<InitializeResponse>("initialize", { protocolVersion: 1 })
        const session = expectOk(yield* acp.request<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] }))

        const resumed = expectOk(
          yield* acp.request<ResumeSessionResponse>("session/resume", {
            sessionId: session.sessionId,
            cwd: home,
            mcpServers: [],
          }),
        )
        expect(resumed.configOptions?.length).toBeGreaterThan(0)
      }),
    60_000,
  )
})

function verifierConfig(llmUrl: string, skills?: string) {
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
          },
        },
      },
    },
  }
}

function noVariantConfig(llmUrl: string) {
  const config = verifierConfig(llmUrl)
  return {
    ...config,
    provider: {
      test: {
        ...config.provider.test,
        models: {
          "test-model": {
            ...config.provider.test.models["test-model"],
            variants: undefined,
          },
          "second-model": config.provider.test.models["second-model"],
        },
      },
    },
  }
}

const verifierSkill = `---
name: verifier-skill
description: Verifier compatibility skill.
---

# Verifier Skill
`
