import { describe, expect } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { advance, drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const server = "http://console.test"
const logs = "/api/otel/v1/logs"
const claude = Provider.ID.make("claude-agent")
const opus = Model.Ref.make({ providerID: claude, id: Model.ID.make("opus") })
const tokens = { input: 10, output: 20, reasoning: 5, cache: { read: 30, write: 40 } }
const marked = { subscription: true, model: "claude-opus-5-5" }
type Attribute = { key: string; value: { stringValue?: string; intValue?: number } }

function fakeConsole(telemetry: number | "hang" = 200, providers: object = {}) {
  const posts: { authorization: string | null; attributes: Attribute[] }[] = []
  const fetch = async (request: Request) => {
    const path = new URL(request.url).pathname
    if (path === "/api/v2/config") return Response.json({ providers })
    if (path === "/api/v2/telemetry") {
      if (telemetry === "hang") return new Promise<Response>(() => {})
      if (telemetry !== 200) return new Response(null, { status: telemetry })
      return Response.json({ otlpLogsUrl: `${server}${logs}`, headers: { authorization: "Bearer octel_token" } })
    }
    if (path !== logs) return new Response(null, { status: 404 })
    const body = (await request.json()) as {
      resourceLogs: { scopeLogs: { logRecords: { attributes: Attribute[] }[] }[] }[]
    }
    posts.push({
      authorization: request.headers.get("authorization"),
      attributes: body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes,
    })
    return Response.json({})
  }
  return { posts, fetch }
}

const start = Effect.fn(function* (console: ReturnType<typeof fakeConsole>) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make("device"),
      access: "access",
      refresh: "refresh",
      expires: Number.MAX_SAFE_INTEGER,
      metadata: { server, accountID: "user", orgID: "org" },
    }),
  })
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* OpencodePlugin.effect(host).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        HttpClientRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap((web) => Effect.promise(async () => console.fetch(web))),
          Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        ),
      ),
    ),
  )
  yield* drain
})

const step = Effect.fn(function* (model: Model.Ref, native?: SessionMessage.Native, cost = 0) {
  const bus = yield* Bus.Service
  const sessions = yield* Session.Service
  const location = yield* Location.Service
  const sessionID = (yield* sessions.create({ location: { directory: location.directory } })).id
  const assistantMessageID = SessionMessage.ID.create()
  yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.ID.make("build"),
    model,
    started: 0,
  })
  yield* bus.publish(SessionEvent.Step.Ended, {
    sessionID,
    assistantMessageID,
    finish: "stop",
    cost: Money.USD.make(cost),
    tokens,
    native,
  })
  return { sessionID, assistantMessageID }
})

describe("OpencodeTelemetry", () => {
  it.effect("sends one record for a step a Claude plan answered", () =>
    Effect.gen(function* () {
      const console = fakeConsole()
      yield* start(console)
      const sent = yield* step(opus, marked)
      yield* advance(() => console.posts.length > 0)
      expect(console.posts[0].authorization).toBe("Bearer octel_token")
      expect(
        Object.fromEntries(
          console.posts[0].attributes.map((item) => [item.key, item.value.stringValue ?? item.value.intValue]),
        ),
      ).toMatchObject({
        "event.name": "opencode.step_usage",
        provider: "anthropic",
        model: "claude-opus-5-5",
        step_id: sent.assistantMessageID,
        "session.id": sent.sessionID,
        input_tokens: 10,
        output_tokens: 25,
        reasoning_tokens: 5,
        cache_read_tokens: 30,
        cache_write_5m_tokens: 40,
        cache_write_1h_tokens: 0,
      })
    }),
  )

  const gateway = Model.Ref.make({ providerID: Provider.ID.opencode, id: opus.id })
  for (const [name, console, publish] of [
    ["a step without the plan's marker", fakeConsole, step(opus, { model: "opus", fallback: "opencode" })],
    ["a step on a gateway provider", fakeConsole, step(gateway, marked)],
    ["a priced step", fakeConsole, step(opus, marked, 1)],
    ["a provider the Console's config defines", () => fakeConsole(200, { [claude]: {} }), step(opus, marked)],
    ["a workspace that answers 404", () => fakeConsole(404), step(opus, marked)],
  ] as const)
    it.effect(`sends nothing for ${name}`, () =>
      Effect.gen(function* () {
        const fake = console()
        yield* start(fake)
        yield* publish
        yield* drain
        expect(fake.posts).toEqual([])
      }),
    )

  // `start` returns only once the plugin has loaded, and a hanging fetch on that path would never let it.
  it.effect("a hanging telemetry endpoint doesn't hold up load", () => start(fakeConsole("hang")))
})
