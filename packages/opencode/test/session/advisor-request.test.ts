import { expect } from "bun:test"
import { SessionAdvisor } from "../../src/session/advisor"
import { Effect } from "effect"
import { LLMRequestPrep } from "../../src/session/llm/request"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { MessageID, SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { catalogModel, catalogAdvisor, model, executor } from "../fixture/advisor"

const it = testEffect(RuntimeFlags.layer({ client: "test" }))

function input(flags: RuntimeFlags.Info): Parameters<typeof LLMRequestPrep.prepare>[0] {
  return {
    user: {
      id: MessageID.make("msg_fixture"),
      sessionID: SessionID.make("ses_fixture"),
      role: "user",
      agent: "build",
      model: { providerID: catalogModel.providerID, modelID: catalogModel.id },
      time: { created: 0 },
    },
    sessionID: "ses_fixture",
    model: catalogModel,
    agent: {
      name: "build",
      mode: "primary",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      advisor: { model, maxUses: 3 },
    },
    system: [],
    messages: [{ role: "user", content: "Inspect fixture" }],
    tools: {},
    provider: {
      id: catalogModel.providerID,
      name: "Fixture Anthropic",
      source: "config",
      env: [],
      options: { apiKey: "fixture" },
      models: { [executor]: catalogModel, [model]: catalogAdvisor },
    },
    auth: { type: "api", key: "fixture" },
    flags,
    isWorkflow: false,
    purpose: "foreground",
    plugin: {
      trigger: (_name, _input, output) => Effect.succeed(output),
      list: () => Effect.succeed([]),
      init: () => Effect.void,
    },
  }
}

it.effect("registers the provider advisor tool and forces the SDK route", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    const prepared = yield* LLMRequestPrep.prepare(request)
    expect(prepared.tools.advisor).toMatchObject({
      type: "provider",
      id: "anthropic.advisor_20260301",
      args: { model, maxUses: 3 },
    })
    expect(prepared.tools.advisor.execute).toBeUndefined()
    expect(prepared).toMatchObject({ requiresSdk: true })
    expect(prepared.headers["anthropic-beta"]).toContain("advisor-tool-2026-03-01")
  }),
)

for (const purpose of ["final", "helper"] as const) {
  it.effect(`does not advertise new advice for ${purpose} requests`, () =>
    Effect.gen(function* () {
      const request = { ...input(yield* RuntimeFlags.Service), purpose }
      const prepared = yield* LLMRequestPrep.prepare(request)
      expect(prepared.tools).not.toHaveProperty("advisor")
    }),
  )
}

it.effect("respects advisor denial", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    const prepared = yield* LLMRequestPrep.prepare({
      ...request,
      permission: [{ permission: "advisor", pattern: "*", action: "deny" }],
    })
    expect(prepared.tools).not.toHaveProperty("advisor")
  }),
)

it.effect("rejects an ambiguous ask grant for provider-side consultations", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    const failure = yield* LLMRequestPrep.prepare({
      ...request,
      permission: [{ permission: "advisor", pattern: "*", action: "ask" }],
    }).pipe(Effect.exit)
    expect(failure._tag).toBe("Failure")
  }),
)

it.effect("retains beta support for history while advice is disabled", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    request.agent.advisor = false
    const prepared = yield* LLMRequestPrep.prepare({
      ...request,
      model: { ...catalogModel, headers: { "Anthropic-Beta": "custom-beta" } },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "srv_previous", toolName: "advisor", input: {}, providerExecuted: true },
            {
              type: "tool-result",
              toolCallId: "srv_previous",
              toolName: "advisor",
              output: { type: "json", value: { type: "advisor_result", text: "Advice" } },
            },
          ],
        },
      ],
    })
    expect(prepared.tools).not.toHaveProperty("advisor")
    expect(prepared).toMatchObject({ requiresSdk: true })
    expect(prepared.headers["anthropic-beta"]).toBe("custom-beta,advisor-tool-2026-03-01")
    expect(prepared.headers).not.toHaveProperty("Anthropic-Beta")
  }),
)

it.effect("rejects unsupported provider routes and subscription auth", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    const proxy = {
      ...request,
      provider: { ...request.provider, options: { apiKey: "fixture", baseURL: "https://proxy.invalid/v1" } },
    }
    expect((yield* LLMRequestPrep.prepare(proxy).pipe(Effect.exit))._tag).toBe("Failure")
    const oauth = { ...request, auth: { type: "oauth" as const, access: "fixture", refresh: "fixture", expires: 0 } }
    expect((yield* LLMRequestPrep.prepare(oauth).pipe(Effect.exit))._tag).toBe("Failure")
  }),
)

it.effect("replays advisor history as text when the route or credentials can no longer carry it", () =>
  Effect.gen(function* () {
    const request = input(yield* RuntimeFlags.Service)
    request.agent.advisor = false
    const history = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "srv_previous",
            toolName: "advisor",
            input: {},
            providerExecuted: true,
          },
          {
            type: "tool-result" as const,
            toolCallId: "srv_previous",
            toolName: "advisor",
            output: { type: "json" as const, value: { type: "advisor_result", text: "Use bounded concurrency." } },
          },
          { type: "text" as const, text: "Applied." },
        ],
      },
    ]
    for (const variant of [
      {
        ...request,
        messages: history,
        auth: { type: "oauth" as const, access: "fixture", refresh: "fixture", expires: 0 },
      },
      {
        ...request,
        messages: history,
        provider: { ...request.provider, options: { apiKey: "fixture", baseURL: "https://proxy.invalid/v1" } },
      },
    ]) {
      const prepared = yield* LLMRequestPrep.prepare(variant)
      const text = JSON.stringify(prepared.messages)
      expect(prepared).toMatchObject({ requiresSdk: false })
      expect(prepared.headers["anthropic-beta"] ?? "").not.toContain("advisor-tool-2026-03-01")
      expect(text).not.toContain('"toolName":"advisor"')
      expect(text).toContain("Use bounded concurrency.")
      expect(text).toContain("Applied.")
    }
  }),
)

it.effect("marks an unanswered call as interrupted when demoting history", () => {
  const demoted = SessionAdvisor.demote([
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "srv_pending", toolName: "advisor", input: {}, providerExecuted: true },
      ],
    },
    { role: "user", content: "next" },
  ])
  expect(demoted).toEqual([
    { role: "assistant", content: [{ type: "text", text: SessionAdvisor.interrupted }] },
    { role: "user", content: "next" },
  ])
  return Effect.void
})
