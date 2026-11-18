export * as OpencodeMemory from "./opencode-memory.js"

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
import { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"
import type { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may use the workspace's memory. */
export const header = "x-opencode-memory"
const namespace = "memory"
/** Sessions whose files and injections are remembered; the least recently active is forgotten first. */
const MAX_SESSIONS = 500
const MAX_FILES = 20

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
const Problem = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Number),
})
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
  const tracked = (sessionID: string) => {
    const found = sessions.get(sessionID) ?? { files: [], injected: { prompt: 0, failure: 0 } }
    sessions.delete(sessionID)
    sessions.set(sessionID, found)
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value ?? sessionID)
    return found
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
      begin(event.sessionID, {
        type: "prompt",
        text: event.prompt.text,
        files: (event.prompt.files ?? []).flatMap((file) =>
          file.uri.startsWith("file:") ? [relative(ctx.location.directory, fileURLToPath(file.uri))] : [],
        ),
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
    // The request after a moment waits for its injection, at most the policy's timeout; other requests find none.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const state = sessions.get(event.sessionID)
        const pending = state?.pending
        if (!state || !pending) return
        state.pending = undefined
        const delivery = yield* Fiber.join(pending)
        if (!delivery || delivery.hits.length === 0) return
        const text = policy.render(delivery.hits, delivery.moment)
        const ids = delivery.hits.map((hit) => hit.id)
        // Persisted so later requests keep it. It lands after this step, so this request gets it at the end, which
        // keeps the cached prefix. Console never injects an entry twice in a session, so its IDs name the message.
        yield* ctx.session.synthetic({
          sessionID: event.sessionID,
          id: SessionMessage.ID.make(`msg_memory_${Hash.sha256(`${event.sessionID}\n${ids.join(",")}`).slice(0, 26)}`),
          text,
          description: `${ids.length === 1 ? "1 memory entry" : `${ids.length} memory entries`} for this ${delivery.moment.type === "prompt" ? "task" : "failure"}`,
          metadata: { source: "console.memory", moment: delivery.moment.type, entries: ids },
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
          "Your OpenCode Console workspace's shared memory: what coding agents across the workspace learned about its repositories, such as root causes and fixes, conventions, build, test and CI steps, API gotchas, decisions and approaches that failed.",
      })
      editor.add({
        name: "search",
        description:
          "Search the workspace's memory before working out something other members' agents may already have: an error you don't recognize, a failing build or test, an unfamiliar service, API or convention, a deploy step. Search with what you have: the exact error message, symbol or file path, or the problem in plain words. Lists each match's id, title, preview and repository, best first; `read` one for its full text.",
        input: Schema.Struct({
          query: Schema.String.annotate({
            description: "An error message, symbol, path or command, and what you're trying to find out",
          }),
          tags: Schema.optional(Tags.annotate({ description: "Only entries with all of these tags" })),
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
            ...(input.tags === undefined ? {} : { tags: input.tags }),
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
          "Read a memory entry in full, by the id `search` or a delivered entry showed, with the repository, branch and commit it was written from. Entries are other agents' notes and may be about another repository or an older revision: check what matters against the code before relying on it, and `update` the entry when it's wrong.",
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
        description: [
          "Publish to the workspace's memory what another member's coding agent would want to know before similar work, once you've verified it. What's worth it:",
          "- a bug's root cause and the fix pattern, with the error message as it appears",
          "- a repository convention the code or its reviewers expect",
          "- how to build, test, run or release something, and what CI needs",
          "- an API, library or service gotcha",
          "- a decision and its reason",
          "- an approach that failed, and why",
          "Not progress notes, task logs, anything a README or AGENTS.md already says, or anything secret. Use a specific title and a body that stands on its own: the exact errors, commands, file paths and symbols, so a search for them finds it. The repository, branch and commit are recorded with it. Publishing first looks for close entries: when there are some, nothing is published and they are listed, so `update` the one that covers this, or publish again with `distinct` when none does.",
        ].join("\n"),
        input: Schema.Struct({
          title: Schema.String.annotate({ description: "What the entry is about, specific enough to find" }),
          body: Schema.String.annotate({ description: "The entry, in Markdown, readable without this session" }),
          tags: Schema.optional(Tags),
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
              {
                title: input.title,
                body: input.body,
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                source: { ...(yield* checkout), sessionID: context.sessionID },
              },
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
          "Update a memory entry: correct it, add what you learned, note a newer fix or that it no longer applies. Send the revision you read; if someone changed it since, the update is refused, so read it again and merge. The title, body or tags you send replace the old ones whole; what you leave out stays. The repository, branch and commit are recorded with the change.",
        input: Schema.Struct({
          id: Schema.String,
          revision: Schema.Int.annotate({ description: "The entry's revision when you read it" }),
          title: Schema.optional(Schema.String),
          body: Schema.optional(Schema.String.annotate({ description: "The whole new body, in Markdown" })),
          tags: Schema.optional(Tags),
        }),
        output: Entry,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            if (input.title === undefined && input.body === undefined && input.tags === undefined)
              return yield* new ToolFailure({ message: "update takes a new title, body, tags or several" })
            const entry = yield* call(Entry, "PATCH", `/api/memory/entries/${encodeURIComponent(input.id)}`, {
              expectedRevision: input.revision,
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.body === undefined ? {} : { body: input.body }),
              ...(input.tags === undefined ? {} : { tags: input.tags }),
              source: { ...(yield* checkout), sessionID: context.sessionID },
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
  const source = entry.source
  const about = [
    entry.id,
    `revision ${entry.revision}`,
    entry.tags && entry.tags.length > 0 && `tags ${entry.tags.join(", ")}`,
    source?.repo && `from ${source.repo}${source.branch ? `@${source.branch}` : ""}`,
    source?.commitSha && `commit ${source.commitSha}`,
    entry.updatedBy && `updated by ${entry.updatedBy.label}`,
    entry.updatedAt && `at ${entry.updatedAt}`,
  ]
  return `# ${entry.title}\n(${about.filter(Boolean).join(", ")})\n\n${entry.body}`
}
