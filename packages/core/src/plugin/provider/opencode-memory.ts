export * as OpencodeMemory from "./opencode-memory.js"

import path from "path"
import { fileURLToPath } from "url"
import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { Effect, Exit, Fiber, Option, Schema, Scope, Struct } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Git } from "../../git.js"
import { AbsolutePath } from "../../schema.js"
import { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"
import type { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may use the workspace's memory. */
export const header = "x-opencode-memory"
const namespace = "memory"
/** Sessions whose files and injections are remembered; the least recently active is forgotten first. */
const MAX_SESSIONS = 500
const MAX_FILES = 20
/** Entries a session was given that a correction may name, and how much of each is kept to match it. */
const MAX_GIVEN = 10
const MAX_GIVEN_TEXT = 2000

// Console's entries and search hits, read leniently: only what the tools show.
const Source = Schema.Struct({
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  commitSha: Schema.optional(Schema.String),
})
const Entry = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  tags: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.optional(Source),
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
    source: Schema.optional(Source),
  }),
  score: Schema.Number,
})
const Hit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  snippet: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
  repo: Schema.optional(Schema.String),
})
/** What a write answers: the new revision and a short diff of what changed, enough to write again without a read. */
const Written = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  title: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
  warnings: Schema.optional(Schema.Array(Schema.String)),
  rebasedFrom: Schema.optional(Schema.Number),
})
const Published = Schema.Struct({ entry: Written, related: Schema.optional(Schema.Array(WireHit)) })
/** A refused write: nothing was written; Console says why, what the entry holds now and the one call to make next. */
const Problem = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  next: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Number),
  currentText: Schema.optional(Schema.String),
  // Read one by one, so a candidate in another shape never hides the message and the next call.
  candidates: Schema.optional(Schema.Array(Schema.Unknown)),
})
const decodeCandidate = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    revision: Schema.Number,
    snippet: Schema.optional(Schema.String),
  }),
)
// The tool inputs and results that tell which files a session works on and which commands fail.
const PathInput = Schema.Struct({ path: Schema.String })
const PatchInput = Schema.Struct({ patchText: Schema.String })
const ShellInput = Schema.Struct({ command: Schema.String })
const ShellOutput = Schema.Struct({ exitCode: Schema.NullOr(Schema.Number), output: Schema.String })
const Tags = Schema.Array(
  Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._/-]{0,63}$/)).annotate({
    description:
      "Lowercase, such as the entry's kind: fix, convention, build, gotcha, decision or failed-approach; or an area such as auth or ci",
  }),
)

type Delivery = { readonly hits: ReadonlyArray<OpencodeMemoryPolicy.Hit>; readonly moment: OpencodeMemoryPolicy.Moment }
type Tracked = {
  readonly files: string[]
  readonly injected: { prompt: number; failure: number }
  /** Entries injected or read, oldest first, as this session last saw them. */
  readonly given: Map<string, OpencodeMemoryPolicy.Given>
  /** A given entry the user's latest message may correct, for the next request to point out. */
  nudge?: { readonly entry: OpencodeMemoryPolicy.Given; readonly messageID: string }
  /** An injection started at a moment, waiting for the model request that follows it. */
  pending?: Fiber.Fiber<Delivery | undefined>
}

/**
 * The workspace's shared memory for one Location: while `sync` is given a Console, the `memory` tools, and the hooks
 * that deliver relevant entries at the moments the policy picks, from what the coding session shows: its task, the
 * files it reads and changes, its repository and its failing commands. Given none, there is nothing. Console logs what
 * it delivers and which entries are opened.
 */
export const make = Effect.fnUntraced(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  policy: OpencodeMemoryPolicy.Policy = OpencodeMemoryPolicy.current,
) {
  const scope = yield* Scope.Scope
  const git = yield* Git.Service
  let current: { console: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  const sessions = new Map<string, Tracked>()
  const tracked = (sessionID: string): Tracked => {
    const found = sessions.get(sessionID) ?? { files: [], injected: { prompt: 0, failure: 0 }, given: new Map() }
    sessions.delete(sessionID)
    sessions.set(sessionID, found)
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value ?? sessionID)
    return found
  }
  const give = (state: Tracked, entry: OpencodeMemoryPolicy.Given) => {
    state.given.delete(entry.id)
    state.given.set(entry.id, { ...entry, text: entry.text.slice(0, MAX_GIVEN_TEXT) })
    if (state.given.size > MAX_GIVEN) state.given.delete(state.given.keys().next().value ?? entry.id)
  }
  // After this session writes an entry it was given, a nudge names the revision it now has.
  const wrote = (sessionID: string, written: typeof Written.Type) => {
    const state = sessions.get(sessionID)
    const given = state?.given.get(written.id)
    if (state && given) give(state, { ...given, title: written.title ?? given.title, revision: written.revision })
  }

  // The checkout as it is now: its remote names the repository, without any credentials the URL holds.
  const checkout = Effect.gen(function* () {
    const repository = yield* git.repo.discover(AbsolutePath.make(ctx.location.directory))
    if (!repository) return {}
    const [remote, branch, commitSha] = yield* Effect.all(
      [
        git.remote.get(repository).pipe(Effect.orElseSucceed(() => undefined)),
        git.history.branch(repository),
        git.history.head(repository),
      ],
      { concurrency: 3 },
    )
    const repo = remote === undefined ? undefined : repoName(remote)
    return {
      ...(repo === undefined ? {} : { repo }),
      ...(branch === undefined ? {} : { branch }),
      ...(commitSha === undefined ? {} : { commitSha }),
    }
  }).pipe(Effect.catchCause(() => Effect.succeed({})))
  // Moments only need which repository and branch; reading them once per Location keeps Git off every moment.
  const repository = yield* Effect.cached(checkout)

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
  // A revision of an entry, answered with its number and diff; the repository, branch and commit are recorded with it.
  const write = (sessionID: string, id: string, change: Record<string, unknown>) =>
    Effect.gen(function* () {
      const written = yield* call(Written, "PATCH", `/api/memory/entries/${encodeURIComponent(id)}`, {
        ...change,
        source: { ...(yield* checkout), sessionID },
      })
      wrote(sessionID, written)
      return { output: written, content: receipt(written) }
    }).pipe(Effect.mapError(failure))

  const start = Effect.fnUntraced(function* () {
    const lease = yield* Scope.Scope
    // Read now, so the first moment doesn't wait on Git.
    yield* repository.pipe(Effect.forkIn(lease, { startImmediately: true }))
    // Only Console is asked in the background, so neither a prompt nor a tool waits on it; one at a time per session.
    const begin = (sessionID: Session.ID, moment: OpencodeMemoryPolicy.Moment) =>
      Effect.gen(function* () {
        const state = tracked(sessionID)
        if (state.pending) return
        const session = yield* ctx.session.get({ sessionID })
        const inject = policy.inject(
          moment,
          { ...(yield* repository), files: [...state.files], injected: { ...state.injected } },
          session,
        )
        if (!inject) return
        state.injected[moment.type]++
        state.pending = yield* call(Schema.Struct({ entries: Schema.Array(WireHit) }), "POST", "/api/memory/inject", {
          sessionID,
          ...inject,
        }).pipe(
          Effect.timeout(policy.timeout),
          Effect.map((answer): Delivery => ({ hits: answer.entries.map(hit), moment })),
          Effect.catch((cause) => Effect.logDebug("memory injection failed", { cause }).pipe(Effect.as(undefined))),
          Effect.forkIn(lease, { startImmediately: true }),
        )
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to start a memory injection", { cause })))

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const state = tracked(event.sessionID)
        const corrected = policy.correction(event.prompt.text, [...state.given.values()])
        if (corrected) state.nudge = { entry: corrected, messageID: event.messageID }
        yield* begin(event.sessionID, {
          type: "prompt",
          text: event.prompt.text,
          files: (event.prompt.files ?? []).flatMap((file) =>
            file.uri.startsWith("file:") ? [relative(ctx.location.directory, fileURLToPath(file.uri))] : [],
          ),
        })
      }),
    )
    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") return Effect.void
      const files = touched(event.tool, event.input).map((file) => relative(ctx.location.directory, file))
      if (files.length > 0) {
        const state = tracked(event.sessionID)
        files.forEach((file) => {
          if (state.files.includes(file)) state.files.splice(state.files.indexOf(file), 1)
          state.files.push(file)
        })
        state.files.splice(0, Math.max(0, state.files.length - MAX_FILES))
      }
      if (event.tool !== "shell") return Effect.void
      const shell = Option.all({
        input: Schema.decodeUnknownOption(ShellInput)(event.input),
        output: Schema.decodeUnknownOption(ShellOutput)(event.result.output),
      })
      // A command still running in the background, or one a signal ended, has no exit code yet.
      if (Option.isNone(shell) || !shell.value.output.exitCode) return Effect.void
      return begin(event.sessionID, {
        type: "failure",
        command: shell.value.input.command,
        output: shell.value.output.output,
        exitCode: shell.value.output.exitCode,
      })
    })
    // The request after a moment waits for its injection, at most the policy's timeout, and the request after a
    // correcting message points out the entry it may correct. Other requests find neither. Both are persisted so later
    // requests keep them, and land after this step, so this request gets them at the end, which keeps the cached prefix.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const state = sessions.get(event.sessionID)
        if (!state || (!state.pending && !state.nudge)) return
        const pending = state.pending
        const nudge = state.nudge
        state.pending = undefined
        state.nudge = undefined
        const delivery = pending ? yield* Fiber.join(pending) : undefined
        // Console never injects an entry twice in a session; one the agent read already isn't injected either.
        const hits = delivery?.hits.filter((hit) => !state.given.has(hit.id)) ?? []
        if (delivery && hits.length > 0) {
          const text = policy.render(hits, delivery.moment)
          const ids = hits.map((hit) => hit.id)
          yield* ctx.session.synthetic({
            sessionID: event.sessionID,
            id: messageID(event.sessionID, ids.join(",")),
            text,
            description: `${ids.length === 1 ? "1 memory entry" : `${ids.length} memory entries`} for this ${delivery.moment.type === "prompt" ? "task" : "failure"}`,
            metadata: { source: "console.memory", moment: delivery.moment.type, entries: ids },
            resume: false,
          })
          event.messages.push(Message.user(text))
          hits.forEach((hit) =>
            give(state, { id: hit.id, revision: hit.revision, title: hit.title, text: hit.body ?? hit.snippet }),
          )
        }
        if (!nudge) return
        const entry = state.given.get(nudge.entry.id) ?? nudge.entry
        const text = policy.nudge(entry)
        // Recorded with the entry it names, so whether an edit to it followed can be counted.
        yield* ctx.session.synthetic({
          sessionID: event.sessionID,
          id: messageID(event.sessionID, `correction:${nudge.messageID}`),
          text,
          description: `Memory entry ${entry.id} may need a correction`,
          metadata: { source: "console.memory", kind: "correction", entry: entry.id, revision: entry.revision },
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
          "Your OpenCode Console workspace's shared memory: what coding agents across the workspace learned about its repositories. Entries are editable: fix one that's wrong, especially when the user corrects it.",
      })
      editor.add({
        name: "search",
        description:
          "Search the workspace's memory before working out what teammates' agents may already know: an unfamiliar error, failing build or test, service, API, convention or deploy step. Query with the exact error, symbol or path, or plain words. Lists id, revision, title and preview, best first.",
        input: Schema.Struct({
          query: Schema.String,
          tags: Schema.optional(Tags.annotate({ description: "Only entries with all of these tags" })),
          limit: Schema.optional(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({ description: "Default 10" }),
          ),
        }),
        output: Schema.Struct({ results: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          call(Schema.Struct({ results: Schema.Array(WireHit) }), "POST", "/api/memory/search", {
            query: input.query,
            ...(input.tags === undefined ? {} : { tags: input.tags }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            sessionID: context.sessionID,
          }).pipe(
            Effect.map((answer) => answer.results.map(listed)),
            Effect.map((results) => ({
              output: { results },
              content: results.length === 0 ? "No matches." : results.map(OpencodeMemoryPolicy.summary).join("\n"),
            })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "read",
        description:
          "Read a memory entry in full, with where it was written from. Entries may be about another repository or an older revision: verify before relying on one, and `edit` it when it's wrong.",
        input: Schema.Struct({ id: Schema.String }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          call(
            Entry,
            "GET",
            `/api/memory/entries/${encodeURIComponent(input.id)}?${new URLSearchParams({ sessionID: context.sessionID })}`,
          ).pipe(
            Effect.tap((entry) =>
              Effect.sync(() =>
                give(tracked(context.sessionID), {
                  id: entry.id,
                  revision: entry.revision,
                  title: entry.title,
                  text: entry.body,
                }),
              ),
            ),
            Effect.map((entry) => ({ output: entry, content: show(entry) })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "publish",
        description:
          "Publish what a teammate's coding agent would want to know before similar work, once verified: a root cause and fix (with the error as it appears), a repo convention, a build/test/CI/release step, an API gotcha, a decision and why, an approach that failed and why. Not progress notes, what README or AGENTS.md says, or secrets. Specific title; a self-contained body with exact errors, commands, paths and symbols. Repo, branch and commit are recorded. If a close entry exists, nothing is published and the error names it and the call to make instead.",
        input: Schema.Struct({
          title: Schema.String,
          body: Schema.String.annotate({ description: "Markdown" }),
          tags: Schema.optional(Tags),
          distinctFrom: Schema.optional(
            Schema.Array(Schema.String).annotate({
              description: "Ids of close entries you checked that don't cover this; publishes anyway",
            }),
          ),
        }),
        output: Schema.Struct({ entry: Written, related: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const published = yield* call(Published, "POST", "/api/memory/entries", {
              title: input.title,
              body: input.body,
              ...(input.tags === undefined ? {} : { tags: input.tags }),
              ...(input.distinctFrom === undefined ? {} : { distinctFrom: input.distinctFrom }),
              source: { ...(yield* checkout), sessionID: context.sessionID },
              // The same call again, as after a lost answer, replays the first one instead of publishing twice.
              idempotencyKey: Hash.sha256(
                JSON.stringify([input.title, input.body, input.tags ?? [], input.distinctFrom ?? []]),
              ).slice(0, 32),
            })
            const related = (published.related ?? []).map(listed)
            return {
              output: { entry: published.entry, related },
              content: [
                `Published ${published.entry.id} r${published.entry.revision}.`,
                ...(related.length > 0 ? ["Related:", ...related.map(OpencodeMemoryPolicy.summary)] : []),
              ].join("\n"),
            }
          }).pipe(Effect.mapError(failure)),
      })
      editor.add({
        name: "edit",
        description:
          'Change part of an entry: a fix, a correction, an outdated detail. Copy oldText exactly from the entry\'s current body (no line numbers), unique in it, and give newText; for several changes pass edits, applied all together or not at all. Also changes title or tags alone. Pass the revision you read. Fix an entry right away when the user corrects what it says. Example: {"id":"mem_01","revision":3,"oldText":"npm test","newText":"bun test"}',
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int,
          oldText: Schema.optional(Schema.String),
          newText: Schema.optional(Schema.String),
          edits: Schema.optional(
            Schema.Array(Schema.Struct({ oldText: Schema.String, newText: Schema.String })).check(
              Schema.isMaxLength(20),
            ),
          ),
          title: Schema.optional(Schema.String),
          tags: Schema.optional(Tags),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) => {
          const pair = input.oldText === undefined ? [] : [{ oldText: input.oldText, newText: input.newText ?? "" }]
          const edits = [...pair, ...(input.edits ?? [])]
          if (edits.length === 0 && input.title === undefined && input.tags === undefined)
            return Effect.fail(new ToolFailure({ message: "edit takes oldText and newText, edits, a title or tags" }))
          return write(context.sessionID, input.id, {
            expectedRevision: input.revision,
            ...(edits.length === 0 ? {} : { edits }),
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
          })
        },
      })
      editor.add({
        name: "append",
        description:
          "Add to the end of an entry: a new example, case, caveat or follow-up. Never conflicts with other writers, so the revision is optional.",
        input: Schema.Struct({
          id: Schema.String,
          text: Schema.String.annotate({ description: "Markdown" }),
          revision: Schema.optional(Schema.Int),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          write(context.sessionID, input.id, {
            append: input.text,
            ...(input.revision === undefined ? {} : { expectedRevision: input.revision }),
          }),
      })
      editor.add({
        name: "rewrite",
        description:
          "Replace an entry's whole body, only to restructure it; for a fix use `edit`. Keep everything that should not change exactly as it is. Pass the revision you read; the answer shows what was removed.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int,
          body: Schema.String.annotate({ description: "The whole new body, in Markdown" }),
          title: Schema.optional(Schema.String),
          tags: Schema.optional(Tags),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          write(context.sessionID, input.id, {
            expectedRevision: input.revision,
            body: input.body,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
          }),
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
      sessions.clear()
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

/**
 * A remote URL as `host/owner/name`, the same for its SSH and HTTPS forms, and never with the user or token an HTTPS
 * URL may carry. A local path names no shared repository.
 */
export function repoName(remote: string) {
  const match =
    remote.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i) ??
    remote.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)(?:\.git)?\/?$/)
  if (!match?.[1] || !match[2] || remote.startsWith("file:")) return undefined
  return `${match[1].toLowerCase()}/${match[2]}`
}

/** The files a completed tool call read or changed, as its input names them. */
function touched(tool: string, input: unknown) {
  if (tool === "read" || tool === "edit" || tool === "write")
    return Option.match(Schema.decodeUnknownOption(PathInput)(input), {
      onNone: () => [],
      onSome: (value) => [value.path],
    })
  if (tool === "patch")
    return Option.match(Schema.decodeUnknownOption(PatchInput)(input), {
      onNone: () => [],
      onSome: (value) =>
        Array.from(value.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm), (match) =>
          (match[1] ?? "").trim(),
        ),
    })
  return []
}

/** A file inside the session's directory relative to it, any other as given. */
function relative(directory: string, file: string) {
  if (!path.isAbsolute(file)) return file
  const inside = path.relative(directory, file)
  return inside && !inside.startsWith("..") && !path.isAbsolute(inside) ? inside : file
}

function hit(wire: typeof WireHit.Type): OpencodeMemoryPolicy.Hit {
  return {
    id: wire.entry.id,
    title: wire.entry.title,
    // Injections carry whole bodies; their first line stands in for a snippet.
    snippet: wire.entry.snippet ?? wire.entry.body?.split("\n").find((line) => line.trim()) ?? "",
    revision: wire.entry.revision,
    score: wire.score,
    ...(wire.entry.source?.repo === undefined ? {} : { repo: wire.entry.source.repo }),
    ...(wire.entry.body === undefined ? {} : { body: wire.entry.body }),
  }
}

/** A hit as a list shows it: without the body Console may send along. */
function listed(wire: typeof WireHit.Type) {
  return Struct.omit(hit(wire), ["body"])
}

function failure(cause: unknown) {
  return cause instanceof ToolFailure
    ? cause
    : new ToolFailure({ message: "OpenCode Console didn't answer", error: cause })
}

/**
 * The response when Console accepted the request, otherwise a tool failure saying why: Console's message, the close
 * entries or current text it sends, and its one named next call, verbatim.
 */
function expectOk(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.succeed(response)
  return HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
    Effect.option,
    Effect.flatMap((problem) => {
      const body = Option.getOrUndefined(problem)
      const message = [
        body?.message ??
          (response.status === 404
            ? "No such memory entry, or memory is off for this OpenCode Console workspace"
            : `OpenCode Console answered ${response.status}`),
        ...(body?.candidates ?? []).flatMap((item) =>
          Option.match(decodeCandidate(item), {
            onNone: () => [],
            onSome: (candidate) => [
              OpencodeMemoryPolicy.summary({ ...candidate, snippet: candidate.snippet ?? "", score: 0 }),
            ],
          }),
        ),
        ...(body?.currentText === undefined
          ? []
          : [`Current body${body.revision === undefined ? "" : ` (r${body.revision})`}:`, body.currentText]),
        ...(body?.next === undefined ? [] : [`Next: ${body.next}`]),
      ].join("\n")
      return Effect.fail(new ToolFailure({ message, metadata: { status: response.status } }))
    }),
  )
}

/** A write's answer: the new revision, then what Console changed and warns about. */
function receipt(written: typeof Written.Type) {
  return [
    `${written.id} is now r${written.revision}${written.rebasedFrom === undefined ? "" : ` (applied over changes since r${written.rebasedFrom})`}.`,
    ...(written.warnings ?? []).map((warning) => `Warning: ${warning}`),
    ...(written.diff ? [written.diff] : []),
  ].join("\n")
}

/** A message ID that the same session and `key` always give, so admitting it again changes nothing. */
function messageID(sessionID: string, key: string) {
  return SessionMessage.ID.make(`msg_memory_${Hash.sha256(`${sessionID}\n${key}`).slice(0, 26)}`)
}

/** The entry with one compact line of where it came from. */
function show(entry: Entry) {
  const source = entry.source
  const about = [
    `${entry.id} r${entry.revision}`,
    entry.tags && entry.tags.length > 0 && entry.tags.join(","),
    source?.repo &&
      `${source.repo}${source.branch ? `@${source.branch}` : ""}${source.commitSha ? ` ${source.commitSha.slice(0, 12)}` : ""}`,
    entry.updatedBy && `${entry.updatedBy.label}${entry.updatedAt ? ` ${entry.updatedAt.slice(0, 10)}` : ""}`,
  ]
  return `${about.filter(Boolean).join(" · ")}\n# ${entry.title}\n\n${entry.body}`
}
