export * as OpencodeLibrary from "./opencode-library.js"

import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { OpencodeLibraryPolicy } from "./opencode-library-policy.js"
import type { OpencodeWatches } from "./opencode-watches.js"

/**
 * The `GET /api/v2/config` response header Console sends while the workspace has a library. A URL as its value is the
 * library's own address; otherwise the library is served by the Console itself.
 */
export const header = "x-opencode-library"
const namespace = "library"

const Hit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  preview: Schema.optional(Schema.String),
  score: Schema.Number,
})
const Hits = Schema.Struct({ entries: Schema.Array(Hit) })
const Entry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  author: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
})
type Entry = typeof Entry.Type
const Problem = Schema.Struct({ message: Schema.optional(Schema.String) })
type Usage = {
  readonly kind: "delivered" | "opened"
  readonly entryID: string
  readonly sessionID: string
  readonly score?: number
  readonly rank?: number
}

/**
 * The organization's library for one Location: while `sync` is given the library's address and Console sign-in, the
 * `library` tools, and the hooks that deliver relevant entries when a task starts as the policy decides. Given none,
 * there is nothing.
 */
export const make = Effect.fnUntraced(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  policy: OpencodeLibraryPolicy.Policy = OpencodeLibraryPolicy.current,
) {
  const scope = yield* Scope.Scope
  let current: { library: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  // Searches started by a prompt, waiting for the model request that follows it.
  const lookups = new Map<string, Fiber.Fiber<ReadonlyArray<OpencodeLibraryPolicy.Hit>>>()

  const call = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) =>
    Effect.gen(function* () {
      if (!current) return yield* new ToolFailure({ message: "The organization's library is not connected" })
      const request = HttpClientRequest.make(method)(`${current.library.server}${path}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(yield* current.library.headers),
      )
      return yield* HttpClient.withScope(http)
        .execute(body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body))
        .pipe(Effect.flatMap(expectOk))
    })
  const search = (query: string, limit: number) =>
    call("POST", "/api/library/search", { query, limit }).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Hits)),
      Effect.map((body) => body.entries),
      Effect.scoped,
    )
  // Off the caller's path: the usage log never holds up a session or a tool, and a failure only loses its events.
  const report = (events: ReadonlyArray<Usage>) =>
    call("POST", "/api/library/usage", { events }).pipe(
      Effect.scoped,
      Effect.catch((cause) => Effect.logDebug("failed to report library usage", { cause })),
      Effect.forkIn(current?.lease ?? scope, { startImmediately: true }),
      Effect.asVoid,
    )

  const start = Effect.fnUntraced(function* () {
    const lease = yield* Scope.Scope
    // Admission only starts the search, so the prompt is never held up by the library.
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        if (lookups.has(event.sessionID)) return
        const session = yield* ctx.session.get({ sessionID: event.sessionID })
        const query = policy.query({ text: event.prompt.text }, session)
        if (!query) return
        const lookup = yield* search(query.text, query.limit).pipe(
          Effect.timeout(policy.timeout),
          Effect.map(policy.select),
          Effect.catch((cause) =>
            Effect.logDebug("library lookup failed", { cause }).pipe(Effect.as<ReadonlyArray<never>>([])),
          ),
          Effect.forkIn(lease, { startImmediately: true }),
        )
        lookups.set(event.sessionID, lookup)
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to start a library lookup", { cause }))),
    )
    // The request after the prompt waits for its search, at most the policy's timeout. Later requests only find no
    // lookup.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const lookup = lookups.get(event.sessionID)
        if (!lookup) return
        lookups.delete(event.sessionID)
        const hits = yield* Fiber.join(lookup)
        if (hits.length === 0) return
        const text = policy.render(hits)
        // Persisted so later requests keep it. It lands after this step, so this request gets it right after the
        // prompt, which keeps the cached prefix. One ID per session: admitting it again changes nothing.
        yield* ctx.session.synthetic({
          sessionID: event.sessionID,
          id: SessionMessage.ID.make(`msg_library_${Hash.sha256(event.sessionID).slice(0, 26)}`),
          text,
          description:
            hits.length === 1 ? "1 library entry for this task" : `${hits.length} library entries for this task`,
          metadata: { source: "library", entries: hits.map((hit) => hit.id) },
          resume: false,
        })
        event.messages.push(Message.user(text))
        yield* report(
          hits.map((hit, rank) => ({
            kind: "delivered",
            entryID: hit.id,
            sessionID: event.sessionID,
            score: hit.score,
            rank,
          })),
        )
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to deliver library entries", { cause }))),
    )
  })

  yield* ctx.tool
    .transform((editor) => {
      if (!current) return
      editor.namespace({
        name: namespace,
        description:
          "Your OpenCode Console organization's shared library: findings, fixes, decisions and gotchas that agents across the organization published, for every member's agents to reuse.",
      })
      editor.add({
        name: "search",
        description:
          "Search the organization's library before working out something other members' agents may already have: an unfamiliar error, service, API, convention or deploy step. Describe the problem in plain words. Lists each match's id, title and one-line preview, best first; `read` one for its full text.",
        input: Schema.Struct({
          query: Schema.String.annotate({ description: "What you're trying to find out, in plain words" }),
          limit: Schema.optional(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })).annotate({
              description: "The most entries to list; 5 otherwise",
            }),
          ),
        }),
        output: Hits,
        options: { namespace, codemode: true, pinned: true },
        execute: (input) =>
          search(input.query, input.limit ?? 5).pipe(
            Effect.map((entries) => ({
              output: { entries },
              content:
                entries.length === 0
                  ? "Nothing in the library matches."
                  : entries.map(OpencodeLibraryPolicy.summary).join("\n"),
            })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "read",
        description:
          "Read a library entry in full, by the id `search` or a delivered entry showed. Entries are other agents' notes and may be out of date: check what matters against the code before relying on it, and `update` the entry when it's wrong.",
        input: Schema.Struct({ id: Schema.String }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          call("GET", `/api/library/entries/${encodeURIComponent(input.id)}`).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Entry)),
            Effect.scoped,
            Effect.tap((entry) => report([{ kind: "opened", entryID: entry.id, sessionID: context.sessionID }])),
            Effect.map((entry) => ({ output: entry, content: show(entry) })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "publish",
        description:
          "Publish to the organization's library what another member's agent would want to know before similar work: a non-obvious fix, how a system really behaves, a decision and its reason. Not progress notes, task logs or anything secret. Give it a specific title and a body that stands on its own. Publishing first looks for close entries: when there are some, nothing is published and they are listed, so `update` the one that covers this, or publish again with `distinct` when none does.",
        input: Schema.Struct({
          title: Schema.String.annotate({ description: "What the entry is about, specific enough to find" }),
          body: Schema.String.annotate({ description: "The entry, in Markdown, readable without this session" }),
          distinct: Schema.optional(
            Schema.Boolean.annotate({
              description: "Publish even though close entries exist, after checking that none covers this",
            }),
          ),
        }),
        output: Schema.Struct({ entry: Schema.optional(Entry), similar: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input) =>
          Effect.gen(function* () {
            const similar = input.distinct ? [] : policy.similar(yield* search(`${input.title}\n\n${input.body}`, 5))
            if (similar.length > 0)
              return {
                output: { similar },
                content: [
                  "Not published: the library has close entries. Read them, then `update` the one that covers this, or publish again with distinct: true if none does.",
                  ...similar.map(OpencodeLibraryPolicy.summary),
                ].join("\n"),
              }
            const entry = yield* call("POST", "/api/library/entries", { title: input.title, body: input.body }).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(Entry)),
              Effect.scoped,
            )
            return { output: { entry, similar: [] }, content: `Published ${entry.id}: ${entry.title}` }
          }).pipe(Effect.mapError(failure)),
      })
      editor.add({
        name: "update",
        description:
          "Update a library entry by id: correct it, add what you learned, or say what changed. The title or body you send replaces the old one whole; what you leave out stays.",
        input: Schema.Struct({
          id: Schema.String,
          title: Schema.optional(Schema.String),
          body: Schema.optional(Schema.String.annotate({ description: "The whole new body, in Markdown" })),
        }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input) =>
          Effect.gen(function* () {
            if (input.title === undefined && input.body === undefined)
              return yield* new ToolFailure({ message: "update takes a new title, body or both" })
            const entry = yield* call("PATCH", `/api/library/entries/${encodeURIComponent(input.id)}`, {
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.body === undefined ? {} : { body: input.body }),
            }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Entry)), Effect.scoped)
            return { output: entry, content: `Updated ${entry.id}: ${entry.title}` }
          }).pipe(Effect.mapError(failure)),
      })
    })
    .pipe(Effect.orDie)

  /** Connects to `next`, or disconnects when it is undefined; another workspace or address replaces the old one. */
  const sync = Effect.fnUntraced(function* (next: OpencodeWatches.Console | undefined) {
    if (current && next && current.library.key === next.key) {
      current.library = next
      return
    }
    if (!current && !next) return
    if (current) {
      yield* Scope.close(current.lease, Exit.void)
      current = undefined
      lookups.clear()
    }
    if (next) {
      const lease = yield* Scope.fork(scope)
      current = { library: next, lease }
      yield* start().pipe(Scope.provide(lease))
    }
    yield* ctx.tool.reload()
  })

  return { sync }
})

function failure(cause: unknown) {
  return cause instanceof ToolFailure ? cause : new ToolFailure({ message: "The library didn't answer", error: cause })
}

/** The response when the library accepted the request, otherwise a tool failure saying why. */
function expectOk(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.succeed(response)
  return HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
    Effect.option,
    Effect.flatMap((problem) =>
      Effect.fail(
        new ToolFailure({
          message:
            Option.getOrUndefined(problem)?.message ??
            (response.status === 404
              ? "The library has no such entry, or is off for this OpenCode Console workspace"
              : `The library answered ${response.status}`),
          metadata: { status: response.status },
        }),
      ),
    ),
  )
}

function show(entry: Entry) {
  const about = [entry.id, entry.author && `by ${entry.author}`, entry.updatedAt && `updated ${entry.updatedAt}`]
  return `# ${entry.title}\n(${about.filter(Boolean).join(", ")})\n\n${entry.body}`
}
