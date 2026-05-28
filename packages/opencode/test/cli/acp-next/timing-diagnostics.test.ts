import { describe, expect } from "bun:test"
import type { SessionNotification, SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { expectOk, flattenSelectOptions } from "../acp/acp-test-client"
import {
  createAcpNextClient,
  diagnosticFastPathThresholdMs,
  diagnosticFirstSessionThresholdMs,
  expectAlternateValue,
  expectSelectOption,
  finalFastPathThresholdMs,
  finalFirstSessionThresholdMs,
  initialize,
  newSession,
  verifierConfig,
  verifierSkill,
} from "./helpers"

describe("opencode acp-next verifier timing diagnostics", () => {
  cliIt.live(
    "first session timing diagnostic stays below generous threshold",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpNextClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        const started = performance.now()
        yield* initialize(acp)
        const session = yield* newSession(acp, home)
        const durationMs = Math.round(performance.now() - started)

        expect(session.sessionId).toBeTruthy()
        // TODO: replace this diagnostic assertion with finalFirstSessionThresholdMs.
        expect(durationMs).toBeLessThan(diagnosticFirstSessionThresholdMs)
        expect(finalFirstSessionThresholdMs).toBe(500)
      }),
    60_000,
  )

  cliIt.live(
    "warm new session stays below verifier threshold",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpNextClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        yield* newSession(acp, home)

        const started = performance.now()
        const session = yield* newSession(acp, home)
        const durationMs = Math.round(performance.now() - started)

        expect(session.sessionId).toBeTruthy()
        expect(durationMs).toBeLessThan(finalFastPathThresholdMs)
      }),
    60_000,
  )

  cliIt.live(
    "model switch updates currentValue below verifier threshold",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpNextClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)
        const model = expectSelectOption(session.configOptions, "model")
        const nextModel = flattenSelectOptions(model).find((option) => option.value === "test/second-model")?.value
        if (!nextModel) throw new Error("expected second test model")

        const started = performance.now()
        const updated = expectOk(
          yield* acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
            sessionId: session.sessionId,
            configId: "model",
            value: nextModel,
          }),
        )
        const durationMs = Math.round(performance.now() - started)

        expect(expectSelectOption(updated.configOptions, "model").currentValue).toBe(nextModel)
        expect(durationMs).toBeLessThan(finalFastPathThresholdMs)
      }),
    60_000,
  )

  cliIt.live(
    "effort switch updates currentValue below verifier threshold",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const acp = yield* createAcpNextClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)
        const nextEffort = expectAlternateValue(expectSelectOption(session.configOptions, "effort"))

        const started = performance.now()
        const updated = expectOk(
          yield* acp.request<SetSessionConfigOptionResponse>("session/set_config_option", {
            sessionId: session.sessionId,
            configId: "effort",
            value: nextEffort,
          }),
        )
        const durationMs = Math.round(performance.now() - started)

        expect(expectSelectOption(updated.configOptions, "effort").currentValue).toBe(nextEffort)
        expect(durationMs).toBeLessThan(finalFastPathThresholdMs)
      }),
    60_000,
  )

  cliIt.live(
    "warm skill command timing diagnostic stays below generous threshold",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const skills = path.join(home, "skills")
        yield* Effect.promise(() => mkdir(path.join(skills, "verifier-skill"), { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(skills, "verifier-skill", "SKILL.md"), verifierSkill))
        const acp = yield* createAcpNextClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url, skills)) },
        )
        yield* initialize(acp)
        yield* newSession(acp, home)
        const secondSession = yield* newSession(acp, home)

        const started = performance.now()
        yield* acp.waitForNotification<SessionNotification>(
          "session/update",
          (params) =>
            params.sessionId === secondSession.sessionId &&
            params.update.sessionUpdate === "available_commands_update" &&
            params.update.availableCommands.some((command) => command.name === "verifier-skill"),
        )
        const durationMs = Math.round(performance.now() - started)

        // TODO: replace this diagnostic assertion with finalFastPathThresholdMs.
        expect(durationMs).toBeLessThan(diagnosticFastPathThresholdMs)
      }),
    60_000,
  )
})
