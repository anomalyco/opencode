import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ClaudeAccounts } from "@opencode/core/plugin/provider/claude-agent/claude/accounts"
import type { ClaudeIO } from "@opencode/core/plugin/provider/claude-agent/claude/io"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { ID, make } from "@opencode/core/plugin/provider/claude-agent/index"
import { ClaudeIntegration } from "@opencode/core/plugin/provider/claude-agent/integration"
import { ClaudeProvider } from "@opencode/core/plugin/provider/claude-agent/provider"
import { Provider } from "@opencode/core/provider"
import { WebSearch } from "@opencode/core/websearch"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { FakeClaude } from "./lib/fake-claude"
import { FakeIO } from "./lib/fake-io"
import { eventually } from "../../../lib/eventually"
import { testEffect } from "../../../lib/effect"
import { PluginTestLayer } from "../../fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make(ClaudeProvider.ID)
const providerID = WebSearch.ID.make(ClaudeProvider.ID)

const addPlugin = Effect.fn(function* (io: ClaudeIO.Interface) {
  const registry = ClaudeSessions.registry()
  yield* Effect.addFinalizer(() => registry.close())
  const host = yield* PluginHost.make(yield* Plugin.Service, ID)
  yield* make(io, registry).effect(host)
})

const connect = Effect.gen(function* () {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID,
    value: Credential.External.make({
      type: "external",
      methodID: Integration.MethodID.make(ClaudeIntegration.METHOD_ID),
    }),
  })
})

const offered = Effect.gen(function* () {
  const websearch = yield* WebSearch.Service
  return (yield* websearch.providers()).some((provider) => provider.id === providerID)
})

const settings = Effect.fn(function* (value: Record<string, unknown>) {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(ClaudeProvider.ID, (provider) => {
      provider.settings = value
    })
  })
})

const query = Effect.gen(function* () {
  const websearch = yield* WebSearch.Service
  return yield* websearch.query({ query: "Node.js release schedule", providerID })
})

describe("Claude Agent web search", () => {
  it.live("is offered only while connected, and searches in a claude with only WebSearch", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([FakeClaude.expectTurn({ recording: "websearch" })], { probes: true })
      yield* addPlugin(FakeIO.make({ claude }))
      yield* settings({ baseURL: "https://gateway.example" })
      expect(yield* offered).toBe(false)

      const credential = yield* connect
      yield* eventually(offered, (offered) => offered)
      const found = yield* query
      expect(found.results[0]?.title).toStartWith("Summary of all results below, written by Claude")
      expect(found.results[0]?.content).toContain("Node.js")
      expect(found.results.length).toBeGreaterThan(1)
      const search = claude.runs.find((run) => run.args.includes("--tools=WebSearch"))
      expect(search?.args).toContain("--no-session-persistence")
      // Searches go through the same connection as chats
      expect(search?.env.ANTHROPIC_BASE_URL).toBe("https://gateway.example")

      const credentials = yield* Credential.Service
      yield* credentials.remove(credential.id)
      yield* eventually(offered, (offered) => !offered)
      claude.check()
    }),
  )

  it.live("searches on the account folder chats used last", () =>
    Effect.gen(function* () {
      const a = path.resolve("/accounts/a")
      const b = path.resolve("/accounts/b")
      yield* PluginHost.storage(yield* KV.Service, ID).set(ClaudeAccounts.LAST, b)
      const claude = FakeClaude.make([FakeClaude.expectTurn({ recording: "websearch" })], { probes: true })
      yield* addPlugin(FakeIO.make({ claude }))
      yield* settings({ configDir: [a, b] })
      yield* connect
      yield* eventually(offered, (offered) => offered)
      yield* query
      const search = claude.runs.find((run) => run.args.includes("--tools=WebSearch"))
      expect(search?.env.CLAUDE_CONFIG_DIR).toBe(b)
      claude.check()
    }),
  )

  it.live("searches in the active account's folder when no configDir is set", () =>
    Effect.gen(function* () {
      const work = path.resolve("/accounts/work")
      const claude = FakeClaude.make([FakeClaude.expectTurn({ recording: "websearch" })], { probes: true })
      yield* addPlugin(FakeIO.make({ claude }))
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID,
        value: Credential.External.make({
          type: "external",
          methodID: Integration.MethodID.make(ClaudeIntegration.METHOD_ID),
          metadata: { [ClaudeProvider.CONFIG_DIR_KEY]: work },
        }),
      })
      yield* eventually(offered, (offered) => offered)
      yield* query
      const search = claude.runs.find((run) => run.args.includes("--tools=WebSearch"))
      expect(search?.env.CLAUDE_CONFIG_DIR).toBe(work)
      claude.check()
    }),
  )
})
