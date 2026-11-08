export * as OpencodeTelemetry from "./opencode-telemetry.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Exit, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

/** Where a Console workspace takes its members' plan usage, as `GET /api/v2/telemetry` answered. */
export interface Target {
  readonly key: string
  readonly url: string
  readonly headers: Record<string, string>
}

const text = (key: string, stringValue: string) => ({ key, value: { stringValue } })
const count = (key: string, intValue: number) => ({ key, value: { intValue } })

/** Sends one usage record per step a member's Claude plan answered, while `sync` is given a Target. */
export const make = Effect.fnUntraced(function* (ctx: Context, http: HttpClient.HttpClient) {
  const scope = yield* Scope.Scope
  let current: { target: Target; readonly lease: Scope.Closeable } | undefined

  const post = (target: Target, attributes: ReadonlyArray<unknown>, created: number) =>
    HttpClient.withScope(http)
      .execute(
        HttpClientRequest.post(target.url).pipe(
          HttpClientRequest.setHeaders(target.headers),
          HttpClientRequest.bodyJsonUnsafe({
            resourceLogs: [
              {
                resource: { attributes: [text("service.name", "opencode"), text("service.version", ctx.app.version)] },
                scopeLogs: [{ logRecords: [{ timeUnixNano: `${created}000000`, attributes }] }],
              },
            ],
          }),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.scoped,
        Effect.timeout("10 seconds"),
        Effect.catch((cause) => Effect.logWarning("failed to report usage to OpenCode Console", { cause })),
      )

  const start = (live: NonNullable<typeof current>) => {
    // Per subscription, so a step that straddles a workspace switch has no model here and is never sent to the new one.
    const started = new Map<string, Model.Ref>()
    return ctx.event.subscribe({ types: ["session.step.started", "session.step.ended"] }).pipe(
      Stream.runForEach((event) => {
        if (event.type === "session.step.started") {
          started.set(event.data.assistantMessageID, event.data.model)
          return Effect.void
        }
        const model = started.get(event.data.assistantMessageID)
        started.delete(event.data.assistantMessageID)
        const vendorModel = event.data.native?.model
        const tokens = event.data.tokens
        if (
          model?.providerID !== Provider.ID.claudeAgent ||
          event.data.cost !== 0 ||
          event.data.native?.subscription !== true ||
          typeof vendorModel !== "string"
        )
          return Effect.void
        return post(
          live.target,
          [
            text("event.name", "opencode.step_usage"),
            text("event.timestamp", new Date(event.created).toISOString()),
            text("provider", "anthropic"),
            text("model", vendorModel),
            text("step_id", event.data.assistantMessageID),
            text("session.id", event.data.sessionID),
            count("input_tokens", tokens.input),
            // Console counts reasoning inside output; OpenCode keeps them apart.
            count("output_tokens", tokens.output + tokens.reasoning),
            count("reasoning_tokens", tokens.reasoning),
            count("cache_read_tokens", tokens.cache.read),
            count("cache_write_5m_tokens", tokens.cache.write),
            count("cache_write_1h_tokens", 0),
          ],
          event.created,
        ).pipe(Effect.forkIn(live.lease), Effect.asVoid)
      }),
      Effect.forkIn(live.lease, { startImmediately: true }),
    )
  }

  /** Starts reporting to `next`, or stops when it is undefined; a new workspace replaces the old one. */
  const sync = Effect.fnUntraced(function* (next: Target | undefined) {
    if (current && next && current.target.key === next.key) {
      current.target = next
      return
    }
    if (current) yield* Scope.close(current.lease, Exit.void)
    current = next && { target: next, lease: yield* Scope.fork(scope) }
    if (current) yield* start(current)
  }, Effect.uninterruptible)

  return { sync }
})
