export * as OpencodeMemory from "./opencode-memory.js"

import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { Effect, Exit, Fiber, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Git } from "../../git.js"
import { AbsolutePath } from "../../schema.js"
import { OpencodeMemoryAccess } from "./opencode-memory-access.js"
import { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"
import { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may use the workspace's memory. */
export const header = "x-opencode-memory"
const namespace = "memory"
/** Sessions whose files and injections are remembered; the least recently active is forgotten first. */
const MAX_SESSIONS = 500
const MAX_FILES = 20
/** Entries a session was given that a correction may name, and how much of each is kept to match it. */
const MAX_GIVEN = 10
const MAX_GIVEN_TEXT = 2000

// Console's answers, read leniently: only what the tools show.
const Kind = Schema.Literals(["bug", "convention", "procedure", "gotcha", "decision", "failed-approach"])
const Hit = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  snippet: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
})
const Injected = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
})
const Source = Schema.Struct({
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  commitSha: Schema.optional(Schema.String),
})
const Entry = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  tags: Schema.optional(Schema.Array(Schema.String)),
  paths: Schema.optional(Schema.Array(Schema.String)),
  errors: Schema.optional(Schema.Array(Schema.String)),
  repo: Schema.optional(Schema.String),
  source: Schema.optional(Source),
  updatedBy: Schema.optional(Schema.Struct({ label: Schema.String })),
  updatedAt: Schema.optional(Schema.String),
  retired: Schema.optional(
    Schema.Struct({ at: Schema.String, reason: Schema.String, supersededBy: Schema.optional(Schema.String) }),
  ),
})
type Entry = typeof Entry.Type
/** What a write answers: the new revision and a short diff of what changed, enough to write again without a read. */
const Written = Schema.Struct({
  id: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Number),
  nearest: Schema.optional(Schema.Array(Hit)),
  diff: Schema.optional(Schema.String),
  matched: Schema.optional(Schema.Array(Schema.String)),
  rebasedFrom: Schema.optional(Schema.Number),
  changesSince: Schema.optional(Schema.String),
  warnings: Schema.optional(Schema.Array(Schema.String)),
  replayed: Schema.optional(Schema.Boolean),
})
type Written = typeof Written.Type
/** A refused write: nothing was written; Console says why, what the entry holds now, and the one call to make next. */
const Problem = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  next: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Number),
  changes: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  // Passages of the entry (closest or every match) or close entries; read one by one, so a candidate in another shape
  // never hides the message and the next call.
  candidates: Schema.optional(Schema.Array(Schema.Unknown)),
})
const decodePassage = Schema.decodeUnknownOption(
  Schema.Struct({ line: Schema.Number, text: Schema.String, similarity: Schema.optional(Schema.Number) }),
)
const decodeHit = Schema.decodeUnknownOption(Hit)
// The tool inputs and results that tell which files a session works on and which commands fail.
const PathInput = Schema.Struct({ path: Schema.String })
const PatchInput = Schema.Struct({ patchText: Schema.String })
const ShellInput = Schema.Struct({ command: Schema.String })
const ShellOutput = Schema.Struct({ exitCode: Schema.NullOr(Schema.Number), output: Schema.String })
/** Names other editors' tools use for an edit's two texts, which models carry over. */
const EDIT_ALIASES = [
  ["old_string", "oldText"],
  ["old_str", "oldText"],
  ["oldString", "oldText"],
  ["old_text", "oldText"],
  ["new_string", "newText"],
  ["new_str", "newText"],
  ["newString", "newText"],
  ["new_text", "newText"],
] as const
const Tags = Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._/-]{0,63}$/))).annotate({
  description: "Lowercase; general when it holds in any repository, such as a library's pitfall",
})
const Paths = Schema.Array(Schema.String).annotate({
  description: "Repository-relative files, directories ending in / or globs it's about",
})
const Errors = Schema.Array(Schema.String).annotate({
  description: "Error messages or signatures it answers, as they appear",
})
const KindInput = Kind.annotate({
  description:
    "bug: symptom, cause, fix. convention: how this code does it. procedure: build, test, CI, release. gotcha: an API or tool pitfall. decision: what and why, with commits. failed-approach: what didn't work and why",
})

type Tracked = {
  readonly files: string[]
  readonly injected: { prompt: number; failure: number }
  /** Entries injected or read, oldest first, as this session last saw them. */
  readonly given: Map<string, OpencodeMemoryPolicy.Given>
  /** Per entry, each revision this session wrote over the one before it, by that one: its own edits aren't news to it. */
  readonly revisions: Map<string, Map<number, number>>
  task?: string
  /** A given entry the user's latest message may correct, for the next request to point out. */
  nudge?: { readonly entry: OpencodeMemoryPolicy.Given; readonly messageID: string }
  /** An injection started at a moment, waiting for the model request that follows it. */
  pending?: Fiber.Fiber<
    | { readonly entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>; readonly moment: OpencodeMemoryPolicy.Moment }
    | undefined
  >
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
    const found = sessions.get(sessionID) ?? {
      files: [],
      injected: { prompt: 0, failure: 0 },
      given: new Map(),
      revisions: new Map(),
    }
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
  // After this session writes an entry, a nudge names the revision it now has, and a later write from the revision it
  // wrote over goes on from this one. A write applied over someone else's change isn't chained: that change is news.
  const wrote = (sessionID: string, id: string, expected: number, written: Written) => {
    const state = tracked(sessionID)
    const given = state.given.get(id)
    if (written.revision === undefined) return
    if (given) give(state, { ...given, revision: written.revision })
    if (written.rebasedFrom !== undefined) return
    const chain = state.revisions.get(id) ?? new Map<number, number>()
    chain.set(expected, written.revision)
    state.revisions.set(id, chain)
  }
  /**
   * The revision to send for a write the agent bases on `revision`: the latest one this session wrote from it, so
   * several writes to one entry in a turn, each citing the revision it read, don't conflict with each other.
   */
  const based = (sessionID: string, id: string, revision: number): number => {
    const next = sessions.get(sessionID)?.revisions.get(id)?.get(revision)
    return next === undefined || next <= revision ? revision : based(sessionID, id, next)
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
    // Console takes the repository as a remote URL; this one carries no credentials.
    const name = remote === undefined ? undefined : repoName(remote)
    const repo = name === undefined ? undefined : `https://${name}`
    return {
      ...(repo === undefined ? {} : { repo }),
      ...(branch === undefined ? {} : { branch }),
      ...(commitSha === undefined ? {} : { commitSha }),
    }
  }).pipe(Effect.catchCause(() => Effect.succeed({})))
  // Moments and searches only need which repository and branch; reading them once per Location keeps Git off them.
  const repository = yield* Effect.cached(checkout)
  // Where this machine's paths start, to make what a write says about them shareable.
  const roots = yield* Effect.cached(
    git.repo
      .discover(AbsolutePath.make(ctx.location.directory))
      .pipe(Effect.map((found) => ({ checkout: found?.worktree ?? ctx.location.directory, home: os.homedir() }))),
  )
  // A write's fields with this machine's paths made relative, or a refusal before anything is sent when one holds a
  // secret, naming the field and the kind but never the value.
  const shared = (tool: string, fields: Record<string, unknown>) =>
    Effect.gen(function* () {
      const result = OpencodeMemoryAccess.share(fields, yield* roots)
      if ("fields" in result) return result.fields
      return yield* new ToolFailure({
        message: `Nothing was sent: ${result.field} holds ${result.kind}, which may not go into the workspace's shared memory. Replace it with a variable reference such as $TOKEN or a placeholder such as <password>, then call ${namespace}.${tool} again.`,
      })
    })

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
  // A new revision of an entry, answered with its number and diff; the repository, branch and commit are recorded.
  const write = (
    tool: "edit" | "append" | "rewrite" | "retire",
    sessionID: string,
    id: string,
    revision: number,
    change: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      const fields = yield* shared(tool, change)
      const expectedRevision = based(sessionID, id, revision)
      const written = yield* call(
        Written,
        tool === "retire" ? "POST" : "PATCH",
        `/api/memory/entries/${encodeURIComponent(id)}${tool === "retire" ? "/retire" : ""}`,
        // Console's retire takes no provenance.
        tool === "retire"
          ? { expectedRevision, ...fields }
          : { expectedRevision, ...fields, source: { ...(yield* checkout), sessionID } },
      )
      wrote(sessionID, id, expectedRevision, written)
      return written
    }).pipe(Effect.mapError(failure))
  const metadata = (input: {
    readonly kind?: OpencodeMemoryPolicy.Kind
    readonly title?: string
    readonly tags?: ReadonlyArray<string>
    readonly paths?: ReadonlyArray<string>
    readonly errors?: ReadonlyArray<string>
  }) => ({
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.paths === undefined ? {} : { paths: input.paths }),
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  })

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
          {
            ...(yield* repository),
            ...(state.task === undefined ? {} : { task: state.task }),
            files: [...state.files],
            injected: { ...state.injected },
          },
          session,
        )
        if (!inject) return
        state.injected[moment.type]++
        state.pending = yield* call(Schema.Struct({ entries: Schema.Array(Injected) }), "POST", "/api/memory/inject", {
          sessionID,
          moment: moment.type,
          ...inject,
        }).pipe(
          Effect.timeout(policy.timeout),
          Effect.map((answer) => ({ entries: answer.entries, moment })),
          Effect.catch((cause) => Effect.logDebug("memory injection failed", { cause }).pipe(Effect.as(undefined))),
          Effect.forkIn(lease, { startImmediately: true }),
        )
      }).pipe(Effect.catch((cause) => Effect.logWarning("failed to start a memory injection", { cause })))

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const state = tracked(event.sessionID)
        state.task ??= event.prompt.text
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
    // Models carry other editors' names for an edit's texts; they mean these.
    yield* ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== `${namespace}_edit` || typeof event.input !== "object" || event.input === null)
        return Effect.void
      event.input = aliased(event.input)
      return Effect.void
    })
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
      if (Option.isNone(shell) || shell.value.output.exitCode === null) return Effect.void
      if (!policy.failed(shell.value.input.command, shell.value.output.output, shell.value.output.exitCode))
        return Effect.void
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
        // Console injects a revision once per session; a revision the agent already read isn't injected either.
        const entries =
          delivery?.entries.filter((entry) => (state.given.get(entry.id)?.revision ?? 0) < entry.revision) ?? []
        if (delivery && entries.length > 0) {
          const text = policy.render(entries, delivery.moment)
          const ids = entries.map((entry) => `${entry.id}@${entry.revision}`)
          yield* ctx.session.synthetic({
            sessionID: event.sessionID,
            id: messageID(event.sessionID, ids.join(",")),
            text,
            description: `${ids.length === 1 ? "1 memory entry" : `${ids.length} memory entries`} for this ${delivery.moment.type === "prompt" ? "task" : "failure"}`,
            metadata: { source: "console.memory", moment: delivery.moment.type, entries: ids },
            resume: false,
          })
          event.messages.push(Message.user(text))
          entries.forEach((entry) =>
            give(state, { id: entry.id, revision: entry.revision, title: entry.title, text: entry.body }),
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
          "Search the workspace's memory before working out what teammates' agents may already know: an unfamiliar error, failing build or test, service, API, convention or deploy step. Query with the exact error, symbol or path, or plain words. Lists id, revision, kind, title and preview, best first; the files you worked on rank related entries higher.",
        input: Schema.Struct({
          query: Schema.String,
          kinds: Schema.optional(Schema.Array(Kind)),
          tags: Schema.optional(Tags.annotate({ description: "Only entries with all of these tags" })),
          limit: Schema.optional(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({ description: "Default 10" }),
          ),
        }),
        output: Schema.Struct({ results: Schema.Array(Hit) }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const checkout = yield* repository
            const files = sessions.get(context.sessionID)?.files ?? []
            const answer = yield* call(Schema.Struct({ results: Schema.Array(Hit) }), "POST", "/api/memory/search", {
              query: input.query,
              context: {
                ...("repo" in checkout && checkout.repo !== undefined ? { repo: checkout.repo } : {}),
                ...(files.length === 0 ? {} : { files }),
              },
              ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
              ...(input.tags === undefined ? {} : { tags: input.tags }),
              ...(input.limit === undefined ? {} : { limit: input.limit }),
              sessionID: context.sessionID,
            })
            return {
              output: answer,
              content:
                answer.results.length === 0
                  ? "No matches."
                  : answer.results.map(OpencodeMemoryPolicy.summary).join("\n"),
            }
          }).pipe(Effect.mapError(failure)),
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
          "Publish what a teammate's coding agent would want to know before similar work, once verified, as it holds for the repository as committed: not your uncommitted changes, progress notes, what README or AGENTS.md says, or secrets. Specific title; a self-contained body with exact errors, commands, paths and symbols; paths and errors make it reach sessions on those files and failures. Repo, branch and commit are recorded. If an entry on this subject exists, nothing is published and the answer says which to edit instead.",
        input: Schema.Struct({
          kind: KindInput,
          title: Schema.String,
          body: Schema.String.annotate({ description: "Markdown" }),
          paths: Schema.optional(Paths),
          errors: Schema.optional(Errors),
          tags: Schema.optional(Tags),
          distinctFrom: Schema.optional(
            Schema.Array(Schema.String).annotate({
              description: "Ids of existing entries you checked that don't cover this; publishes beside them",
            }),
          ),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            // The key is the tool call's own: Console answers a retry of this call with what it saved, while an
            // agent's re-issue is a new call that Console's duplicate check catches as this session's own entry.
            const published = yield* call(Written, "POST", "/api/memory/entries", {
              ...(yield* shared("publish", { ...metadata(input), body: input.body })),
              ...(input.distinctFrom === undefined ? {} : { distinctFrom: input.distinctFrom }),
              source: { ...(yield* checkout), sessionID: context.sessionID },
              idempotencyKey: `${context.sessionID}:${context.id}`.slice(0, 128),
            })
            return {
              output: published,
              content: `Published ${published.id} r${published.revision}${published.replayed ? " (this publish was already saved)" : ""}.`,
            }
          }).pipe(Effect.mapError(failure)),
      })
      editor.add({
        name: "edit",
        description:
          'Change part of an entry: a fix, a correction, an outdated detail. Copy oldText exactly from the entry\'s current body (no line numbers), unique in it; newText "" deletes it. For several changes pass edits: each oldText is matched against the revision you read, not after the others, and all apply or none. Also changes kind, title, tags, paths or errors. Pass the revision you read. Fix an entry right away when the user corrects what it says; record what holds for the repository as committed, not your uncommitted changes. Example: {"id":"mem_01","revision":3,"oldText":"npm test","newText":"bun test"}',
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
          kind: Schema.optional(Kind),
          title: Schema.optional(Schema.String),
          tags: Schema.optional(Tags),
          paths: Schema.optional(Paths),
          errors: Schema.optional(Errors),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) => {
          const pair = input.oldText === undefined ? [] : [{ oldText: input.oldText, newText: input.newText ?? "" }]
          const edits = [...pair, ...(input.edits ?? [])]
          const fields = metadata(input)
          if (edits.length === 0 && Object.keys(fields).length === 0)
            return Effect.fail(
              new ToolFailure({
                message: "edit takes oldText and newText, edits, or a new kind, title, tags, paths or errors",
              }),
            )
          return write("edit", context.sessionID, input.id, input.revision, {
            ...(edits.length === 0 ? {} : { edits }),
            ...fields,
          }).pipe(Effect.map((written) => ({ output: written, content: receipt(input.id, written) })))
        },
      })
      editor.add({
        name: "append",
        description:
          "Add new material to the end of an entry: another example, case or follow-up. Not for corrections: fix wrong text with `edit`. Pass the revision you read; it still applies if the entry changed since.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int,
          text: Schema.String.annotate({ description: "Markdown" }),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          write("append", context.sessionID, input.id, input.revision, { append: input.text }).pipe(
            Effect.map((written) => ({ output: written, content: receipt(input.id, written) })),
          ),
      })
      editor.add({
        name: "rewrite",
        description:
          "Replace an entry's whole body, only to restructure it; for a fix use `edit`. Keep everything that should not change exactly as it is, with no placeholders for left-out text. Pass the revision you read; the answer shows what changed.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int,
          body: Schema.String.annotate({ description: "The whole new body, in Markdown" }),
          title: Schema.optional(Schema.String),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          write("rewrite", context.sessionID, input.id, input.revision, { body: input.body, ...metadata(input) }).pipe(
            Effect.map((written) => ({ output: written, content: receipt(input.id, written) })),
          ),
      })
      editor.add({
        name: "retire",
        description:
          "Retire an entry that no longer holds, so it's no longer found or injected: the code changed, the decision was reversed, or another entry replaces it (supersededBy). To fix part of one, use `edit` instead. Pass the revision you read.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int,
          reason: Schema.String.annotate({ description: "Why it no longer holds, in one sentence" }),
          supersededBy: Schema.optional(
            Schema.String.annotate({ description: "The id of the entry that replaces it" }),
          ),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          write("retire", context.sessionID, input.id, input.revision, {
            reason: input.reason,
            ...(input.supersededBy === undefined ? {} : { supersededBy: input.supersededBy }),
          }).pipe(
            Effect.map((written) => ({
              output: written,
              content: `${written.id ?? input.id} is retired (r${written.revision}); it's no longer searched or injected.`,
            })),
          ),
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

/** An edit's input with other editors' names for its texts renamed to this tool's, in the call and in each edit. */
function aliased(input: object): object {
  const rename = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [EDIT_ALIASES.find(([alias]) => alias === key)?.[1] ?? key, item]),
        )
      : value
  const renamed = rename(input) as Record<string, unknown>
  return Array.isArray(renamed.edits) ? { ...renamed, edits: renamed.edits.map(rename) } : renamed
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

function failure(cause: unknown) {
  return cause instanceof ToolFailure
    ? cause
    : new ToolFailure({
        message: "OpenCode Console didn't answer this time; the same call can be retried.",
        error: cause,
      })
}

/**
 * The response when Console accepted the request, otherwise a tool failure saying why: Console's message, what it sends
 * to fix the call with (passages, close entries, changes since, the current body), and its named next call, verbatim.
 */
function expectOk(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.succeed(response)
  return HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
    Effect.option,
    Effect.flatMap((problem) => {
      const body = Option.getOrUndefined(problem)
      const said =
        body?.message ??
        (response.status === 404
          ? "No such memory entry, or memory is off for this OpenCode Console workspace"
          : `OpenCode Console answered ${response.status}`)
      // Console's message ends with its next call; it goes last, once, as Console wrote it.
      const next = body?.next
      const candidates = body?.candidates ?? []
      const passages = candidates.flatMap((item) => Option.toArray(decodePassage(item)))
      const hits = candidates.flatMap((item) =>
        Option.isSome(decodePassage(item)) ? [] : Option.toArray(decodeHit(item)),
      )
      const message = [
        next !== undefined && said.endsWith(next) ? said.slice(0, -next.length).trim() : said,
        // The closest passage is a suggestion: Console found it similar, not the same.
        ...passages.flatMap((passage, index) => [
          `${index === 0 ? "Closest text, check it's your target" : "Also similar"}: line ${passage.line}${passage.similarity === undefined ? "" : ` (${Math.round(passage.similarity * 100)}% similar)`}`,
          OpencodeWatches.fence(passage.text),
        ]),
        ...hits.map(OpencodeMemoryPolicy.summary),
        // Entry text is data, fenced so it can't read as instructions.
        ...(body?.changes === undefined ? [] : ["Changes since your revision:", OpencodeWatches.fence(body.changes)]),
        ...(body?.body === undefined
          ? []
          : [
              `Current body${body.revision === undefined ? "" : ` (r${body.revision})`}:`,
              OpencodeWatches.fence(body.body),
            ]),
        ...(next === undefined ? [] : [`Next: ${next}`]),
      ].join("\n")
      return Effect.fail(
        new ToolFailure({
          message,
          metadata: { status: response.status, tag: body?._tag, candidates: hits.map((hit) => hit.id) },
        }),
      )
    }),
  )
}

/** A write's answer: the new revision, how it applied, what Console warns about, then the diff of what changed. */
function receipt(id: string, written: Written) {
  return [
    `${written.id ?? id} is now r${written.revision}${written.rebasedFrom === undefined ? "" : ` (applied over changes since r${written.rebasedFrom})`}.`,
    ...(written.changesSince === undefined ? [] : [`Changes since r${written.rebasedFrom}:`, written.changesSince]),
    ...(written.matched?.includes("fuzzy") ? ["An oldText matched only approximately: check the diff."] : []),
    ...(written.warnings ?? []).map((warning) => `Warning: ${warning}`),
    ...(written.diff ? [written.diff] : []),
  ].join("\n")
}

/** A message ID that the same session and `key` always give, so admitting it again changes nothing. */
function messageID(sessionID: string, key: string) {
  return SessionMessage.ID.make(`msg_memory_${Hash.sha256(`${sessionID}\n${key}`).slice(0, 26)}`)
}

/** The entry with one compact line of what it is and where it came from. */
function show(entry: Entry) {
  const source = entry.source
  const about = [
    `${entry.id} r${entry.revision} ${entry.kind}`,
    entry.tags && entry.tags.length > 0 && entry.tags.join(","),
    entry.paths && entry.paths.length > 0 && entry.paths.join(" "),
    (source?.repo ?? entry.repo) &&
      `${source?.repo ?? entry.repo}${source?.branch ? `@${source.branch}` : ""}${source?.commitSha ? ` ${source.commitSha.slice(0, 12)}` : ""}`,
    entry.updatedBy && `${entry.updatedBy.label}${entry.updatedAt ? ` ${entry.updatedAt.slice(0, 10)}` : ""}`,
  ]
  const errors = entry.errors && entry.errors.length > 0 ? `\nErrors: ${entry.errors.join(" | ")}` : ""
  const retired = entry.retired
    ? `\nRetired ${entry.retired.at.slice(0, 10)}: ${entry.retired.reason}${entry.retired.supersededBy ? ` (superseded by ${entry.retired.supersededBy})` : ""}`
    : ""
  return `${about.filter(Boolean).join(" · ")}${errors}${retired}\n# ${entry.title}\n\n${entry.body}`
}
