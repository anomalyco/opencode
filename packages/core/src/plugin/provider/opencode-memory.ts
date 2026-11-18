export * as OpencodeMemory from "./opencode-memory.js"

import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"
import type { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may use the workspace's memory. */
export const header = "x-opencode-memory"
const namespace = "memory"

// Console's entries and search hits, read leniently: only what the tools show.
const Entry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  updatedBy: Schema.optional(Schema.Struct({ label: Schema.String })),
  updatedAt: Schema.optional(Schema.String),
})
type Entry = typeof Entry.Type
const WireHit = Schema.Struct({
  entry: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    revision: Schema.Number,
    snippet: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
  }),
  score: Schema.Number,
})
const Hit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  snippet: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
})
const Problem = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Number),
})

/**
 * The workspace's shared memory for one Location: while `sync` is given a Console, the `memory` tools, and the hooks
 * that deliver relevant entries when a task starts, as the policy decides. Given none, there is nothing. Console logs
 * what it delivers and which entries are opened.
 */
export const make = Effect.fnUntraced(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  policy: OpencodeMemoryPolicy.Policy = OpencodeMemoryPolicy.current,
) {
  const scope = yield* Scope.Scope
  let current: { console: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  // Injections started by a prompt, waiting for the model request that follows it.
  const injections = new Map<string, Fiber.Fiber<ReadonlyArray<OpencodeMemoryPolicy.Hit>>>()

  const call = <S extends Schema.Top>(
    schema: S,
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      if (!current) return yield* new ToolFailure({ message: "The workspace's memory is not connected" })
      const request = HttpClientRequest.make(method)(`${current.console.server}${path}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(yield* current.console.headers),
      )
      return yield* HttpClient.withScope(http)
        .execute(body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body))
        .pipe(Effect.flatMap(expectOk), Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
    }).pipe(Effect.scoped)
  // Saves nothing; with the session, Console logs the entries it shows as delivered to it.
  const nearest = (input: { readonly title: string; readonly body: string; readonly sessionID: string }) =>
    call(Schema.Struct({ nearest: Schema.Array(WireHit) }), "POST", "/api/memory/entries", {
      title: input.title,
      body: input.body,
      source: { sessionID: input.sessionID },
      dryRun: true,
    }).pipe(Effect.map((answer) => answer.nearest.map(hit)))

  const start = Effect.fnUntraced(function* () {
    const lease = yield* Scope.Scope
    // Admission only starts the injection, so the prompt is never held up by Console.
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        if (injections.has(event.sessionID)) return
        const session = yield* ctx.session.get({ sessionID: event.sessionID })
        const inject = policy.inject({ text: event.prompt.text }, session)
        if (!inject) return
        const injection = yield* call(Schema.Struct({ entries: Schema.Array(WireHit) }), "POST", "/api/memory/inject", {
          sessionID: event.sessionID,
          ...inject,
        }).pipe(
          Effect.timeout(policy.timeout),
          Effect.map((answer) => answer.entries.map(hit)),
          Effect.catch((cause) =>
            Effect.logDebug("memory injection failed", { cause }).pipe(Effect.as<ReadonlyArray<never>>([])),
          ),
          Effect.forkIn(lease, { startImmediately: true }),
        )
        injections.set(event.sessionID, injection)
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to start a memory injection", { cause }))),
    )
    // The request after the prompt waits for its injection, at most the policy's timeout. Later requests find none.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const injection = injections.get(event.sessionID)
        if (!injection) return
        injections.delete(event.sessionID)
        const hits = yield* Fiber.join(injection)
        if (hits.length === 0) return
        const text = policy.render(hits)
        // Persisted so later requests keep it. It lands after this step, so this request gets it right after the
        // prompt, which keeps the cached prefix. One ID per session: admitting it again changes nothing.
        yield* ctx.session.synthetic({
          sessionID: event.sessionID,
          id: SessionMessage.ID.make(`msg_memory_${Hash.sha256(event.sessionID).slice(0, 26)}`),
          text,
          description:
            hits.length === 1 ? "1 memory entry for this task" : `${hits.length} memory entries for this task`,
          metadata: { source: "console.memory", entries: hits.map((hit) => hit.id) },
          resume: false,
        })
        event.messages.push(Message.user(text))
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to deliver memory entries", { cause }))),
    )
  })

  yield* ctx.tool
    .transform((editor) => {
      if (!current) return
      editor.namespace({
        name: namespace,
        description:
          "Your OpenCode Console workspace's shared memory: findings, fixes, decisions and gotchas that every member's agents publish and reuse.",
      })
      editor.add({
        name: "search",
        description:
          "Search the workspace's memory before working out something other members' agents may already have: an unfamiliar error, service, API, convention or deploy step. Describe the problem in plain words. Lists each match's id, title and a preview, best first; `read` one for its full text.",
        input: Schema.Struct({
          query: Schema.String.annotate({ description: "What you're trying to find out, in plain words" }),
          limit: Schema.optional(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({
              description: "The most entries to list; 10 otherwise",
            }),
          ),
        }),
        output: Schema.Struct({ results: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          call(Schema.Struct({ results: Schema.Array(WireHit) }), "POST", "/api/memory/search", {
            query: input.query,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            sessionID: context.sessionID,
          }).pipe(
            Effect.map((answer) => answer.results.map(hit)),
            Effect.map((results) => ({
              output: { results },
              content:
                results.length === 0
                  ? "Nothing in the workspace's memory matches."
                  : results.map(OpencodeMemoryPolicy.summary).join("\n"),
            })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "read",
        description:
          "Read a memory entry in full, by the id `search` or a delivered entry showed. Entries are other agents' notes and may be out of date: check what matters against the code before relying on it, and `update` the entry when it's wrong.",
        input: Schema.Struct({ id: Schema.String }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          call(
            Entry,
            "GET",
            `/api/memory/entries/${encodeURIComponent(input.id)}?${new URLSearchParams({ sessionID: context.sessionID })}`,
          ).pipe(
            Effect.map((entry) => ({ output: entry, content: show(entry) })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "publish",
        description:
          "Publish to the workspace's memory what another member's agent would want to know before similar work: a non-obvious fix, how a system really behaves, a decision and its reason. Not progress notes, task logs or anything secret. Give it a specific title and a body that stands on its own. Publishing first looks for close entries: when there are some, nothing is published and they are listed, so `update` the one that covers this, or publish again with `distinct` when none does.",
        input: Schema.Struct({
          title: Schema.String.annotate({ description: "What the entry is about, specific enough to find" }),
          body: Schema.String.annotate({ description: "The entry, in Markdown, readable without this session" }),
          distinct: Schema.optional(
            Schema.Boolean.annotate({
              description: "Publish even though close entries exist, after checking that none covers this",
            }),
          ),
        }),
        output: Schema.Struct({ entry: Schema.optional(Entry), nearest: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const similar = input.distinct
              ? []
              : policy.similar(yield* nearest({ ...input, sessionID: context.sessionID }))
            if (similar.length > 0)
              return {
                output: { nearest: similar },
                content: [
                  "Not published: the workspace's memory has close entries. Read them, then `update` the one that covers this, or publish again with distinct: true if none does.",
                  ...similar.map(OpencodeMemoryPolicy.summary),
                ].join("\n"),
              }
            const published = yield* call(
              Schema.Struct({ entry: Entry, nearest: Schema.Array(WireHit) }),
              "POST",
              "/api/memory/entries",
              { title: input.title, body: input.body, source: { sessionID: context.sessionID } },
            )
            return {
              output: { entry: published.entry, nearest: published.nearest.map(hit) },
              content: `Published ${published.entry.id}: ${published.entry.title}`,
            }
          }).pipe(Effect.mapError(failure)),
      })
      editor.add({
        name: "update",
        description:
          "Update a memory entry: correct it, add what you learned, or say what changed. Send the revision you read; if someone changed it since, the update is refused, so read it again and merge. The title or body you send replaces the old one whole; what you leave out stays.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int.annotate({ description: "The entry's revision when you read it" }),
          title: Schema.optional(Schema.String),
          body: Schema.optional(Schema.String.annotate({ description: "The whole new body, in Markdown" })),
        }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            if (input.title === undefined && input.body === undefined)
              return yield* new ToolFailure({ message: "update takes a new title, body or both" })
            const entry = yield* call(Entry, "PATCH", `/api/memory/entries/${encodeURIComponent(input.id)}`, {
              expectedRevision: input.revision,
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.body === undefined ? {} : { body: input.body }),
              source: { sessionID: context.sessionID },
            })
            return { output: entry, content: `Updated ${entry.id} to revision ${entry.revision}: ${entry.title}` }
          }).pipe(Effect.mapError(failure)),
      })
    })
    .pipe(Effect.orDie)

  /** Connects to `next`, or disconnects when it is undefined; another workspace replaces the old one. */
  const sync = Effect.fnUntraced(function* (next: OpencodeWatches.Console | undefined) {
    if (current && next && current.console.key === next.key) {
      current.console = next
      return
    }
    if (!current && !next) return
    if (current) {
      yield* Scope.close(current.lease, Exit.void)
      current = undefined
      injections.clear()
    }
    if (next) {
      const lease = yield* Scope.fork(scope)
      current = { console: next, lease }
      yield* start().pipe(Scope.provide(lease))
    }
    yield* ctx.tool.reload()
  })

  return { sync }
})

function hit(wire: typeof WireHit.Type): OpencodeMemoryPolicy.Hit {
  return {
    id: wire.entry.id,
    title: wire.entry.title,
    // Injections carry whole bodies; their first line stands in for a snippet.
    snippet: wire.entry.snippet ?? wire.entry.body?.split("\n").find((line) => line.trim()) ?? "",
    revision: wire.entry.revision,
    score: wire.score,
  }
}

function failure(cause: unknown) {
  return cause instanceof ToolFailure
    ? cause
    : new ToolFailure({ message: "OpenCode Console didn't answer", error: cause })
}

/** The response when Console accepted the request, otherwise a tool failure saying why. */
function expectOk(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.succeed(response)
  return HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
    Effect.option,
    Effect.flatMap((problem) => {
      const body = Option.getOrUndefined(problem)
      const message =
        body?._tag === "MemoryConflict"
          ? `The entry changed since you read it${body.revision === undefined ? "" : `; it is at revision ${body.revision} now`}. Read it again, merge your change and update with that revision.`
          : response.status === 404
            ? "No such memory entry, or memory is off for this OpenCode Console workspace"
            : (body?.message ?? `OpenCode Console answered ${response.status}`)
      return Effect.fail(new ToolFailure({ message, metadata: { status: response.status } }))
    }),
  )
}

function show(entry: Entry) {
  const about = [
    entry.id,
    `revision ${entry.revision}`,
    entry.updatedBy && `updated by ${entry.updatedBy.label}`,
    entry.updatedAt && `at ${entry.updatedAt}`,
  ]
  return `# ${entry.title}\n(${about.filter(Boolean).join(", ")})\n\n${entry.body}`
}
