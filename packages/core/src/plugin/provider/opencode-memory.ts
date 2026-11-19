export * as OpencodeMemory from "./opencode-memory.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Message, SystemPart, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { AppProcess } from "@opencode/util/process"
import { Clock, Effect, Exit, Fiber, Option, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ChildProcess } from "effect/process"
import { Git } from "../../git.js"
import { AbsolutePath } from "../../schema.js"
import { normalizeContent } from "../../tool/runtime.js"
import { Flag } from "../../flag.js"
import { OpencodeMemoryAccess } from "./opencode-memory-access.js"
import { OpencodeMemoryCapture } from "./opencode-memory-capture.js"
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
/** Events kept in memory since a session's last boundary; the log keeps them all. */
const MAX_SEGMENT = 200
/**
 * Distillations a user turn allows for the boundaries inside it (a test that starts passing, a commit, a finished
 * subtask), refilled by each user message. The boundaries that close a turn (a new task, a correction, a stated rule)
 * and compactions always distil, so a long session never runs out.
 */
const DISTILLATIONS_PER_TURN = 2
/** The end of a command's output an event keeps. */
const MAX_TAIL = 1500
/** How long the workspace's list of restricted repositories is reused before Console is asked again. */
const ANCHORS_MAX_AGE = 60 * 1000
/** The most repositories a reader's reachable set names, as Console takes it. */
const MAX_REACHABLE = 1000

// Console's answers, read leniently: only what the tools show.
const Kind = Schema.Literals(["bug", "convention", "procedure", "gotcha", "decision", "failed-approach"])
const Hit = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  snippet: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
  status: Schema.optional(Schema.Literals(["live", "provisional"])),
})
const Injected = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
})
const Standing = Schema.Struct({
  id: Schema.String,
  kind: Schema.optional(Kind),
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  status: Schema.optional(Schema.Literals(["live", "provisional"])),
  tainted: Schema.optional(Schema.Boolean),
  retired: Schema.optional(Schema.Unknown),
  repo: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  verifiedAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
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
  merged: Schema.optional(Schema.Boolean),
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
const Evidence = Schema.Array(
  Schema.Struct({ kind: Schema.Literals(["commit", "pr", "test", "command", "ci"]), ref: Schema.String }),
)
  .check(Schema.isMaxLength(10))
  .annotate({
    description:
      "What shows it holds: a test or command you ran and saw pass, a commit, PR or CI run. A teammate's evidence makes a provisional entry live",
  })
/** A session that read this has taken in outside input: the web, issue text or other repositories. */
const OUTSIDE = /\b(?:curl|wget|gh (?:issue|pr|api|repo clone)|git clone)\b/
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
  /**
   * Per entry, the revisions this session was shown whole since its last compaction: read, injected or written by it.
   * A rewrite or retire replaces what the entry says, so it starts from one of these.
   */
  readonly shown: Map<string, Set<number>>
  /** Entries injected into the session, whole, to deliver once more after a compaction drops them. */
  readonly delivered: Map<string, OpencodeMemoryPolicy.Injected>
  compactions: number
  /** A compaction ended since the delivered entries were last given. */
  redeliver?: boolean
  /** The session's standing block, built at its first request and never again: "" when none applies. */
  standing?: string
  /** The session's events since its last work boundary, and where they start in its log. */
  readonly segment: Array<OpencodeMemoryCapture.Event>
  from: number
  /** The next position in the session's event log, read from storage on its first event in this process. */
  next?: number
  /** What the current user turn still allows for boundaries inside it. */
  allowance: number
  /** The session took in outside input, so what it publishes is marked tainted and never promoted. */
  tainted?: boolean
  /** The repository (`host/owner/name`) of each entry the session read, unless it holds anywhere (tagged general). */
  readonly about: Map<string, string>
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
  const processes = yield* AppProcess.Service
  const flags = yield* Flag.Service
  const known = (state: Tracked) =>
    [...state.given.values()].map((entry) => ({ id: entry.id, title: entry.title, text: entry.text }))
  const github = OpencodeMemoryAccess.make(http, processes, yield* OpencodeMemoryAccess.GitHub)
  let current: { console: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  const sessions = new Map<string, Tracked>()
  const tracked = (sessionID: string): Tracked => {
    const found = sessions.get(sessionID) ?? {
      files: [],
      injected: { prompt: 0, failure: 0 },
      given: new Map(),
      revisions: new Map(),
      shown: new Map(),
      delivered: new Map(),
      compactions: 0,
      segment: [],
      from: 0,
      allowance: DISTILLATIONS_PER_TURN,
      about: new Map(),
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
    see(state, entry.id, entry.revision)
  }
  const see = (state: Tracked, id: string, revision: number) => {
    state.shown.set(id, (state.shown.get(id) ?? new Set<number>()).add(revision))
  }
  // Whole entries the session was injected, for delivering again after a compaction.
  const deliver = (state: Tracked, entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>) =>
    entries.forEach((entry) => {
      give(state, { id: entry.id, revision: entry.revision, title: entry.title, text: entry.body })
      state.delivered.delete(entry.id)
      state.delivered.set(entry.id, entry)
      if (state.delivered.size > MAX_GIVEN) state.delivered.delete(state.delivered.keys().next().value ?? entry.id)
    })
  // After this session writes an entry, a nudge names the revision it now has, and a later write from the revision it
  // wrote over goes on from this one. A write applied over someone else's change isn't chained: that change is news.
  const wrote = (sessionID: string, id: string, expected: number, written: Written) => {
    const state = tracked(sessionID)
    const given = state.given.get(id)
    if (written.revision === undefined) return
    if (given) give(state, { ...given, revision: written.revision })
    see(state, id, written.revision)
    // What was injected no longer says what the entry does; it isn't delivered again.
    state.delivered.delete(id)
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
        message: `Nothing was sent: ${result.field} holds ${result.kind}, which may not go into the workspace's shared memory. ${result.repair}, then call ${namespace}.${tool} again.`,
      })
    })

  // The checkout's current commit, after the session committed.
  const head = Effect.gen(function* () {
    const result = yield* processes.run(
      ChildProcess.make("git", ["rev-parse", "HEAD"], { cwd: (yield* roots).checkout, stdin: "ignore" }),
    )
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

  /**
   * Refuses a write whose `paths` name a repository path that isn't there. Only clear paths (with a `/`) are checked:
   * globs, dotted module names and root files are taken as given, and git-ignored or generated files pass, as the
   * publish audit's anchor gate refused all of those wrongly.
   */
  const resolved = (tool: string, paths: ReadonlyArray<string> | undefined) =>
    Effect.gen(function* () {
      const checkout = (yield* roots).checkout
      const missing = yield* Effect.filter(
        (paths ?? []).filter((item) => item.includes("/") && !/[*?[\]{}]/.test(item)),
        (item) =>
          Effect.gen(function* () {
            const file = path.join(checkout, item)
            if (
              yield* Effect.promise(() =>
                fs.stat(file).then(
                  () => true,
                  () => false,
                ),
              )
            )
              return false
            const ignored = yield* processes
              .run(ChildProcess.make("git", ["check-ignore", "-q", item], { cwd: checkout, stdin: "ignore" }))
              .pipe(
                Effect.map((result) => result.exitCode === 0),
                Effect.orElseSucceed(() => false),
              )
            return !ignored
          }),
      )
      if (missing.length === 0) return
      return yield* new ToolFailure({
        message: `Nothing was sent: paths name ${missing.map((item) => `"${item}"`).join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in the repository. Fix ${missing.length === 1 ? "it" : "them"} to a file or directory that exists, or leave ${missing.length === 1 ? "it" : "them"} out, then call ${namespace}.${tool} again.`,
      })
    })

  /**
   * Refuses a write whose text names a file this checkout added and hasn't committed: no teammate has it, and agents
   * have recorded their own uncommitted setup (a bunfig.toml) as how the repository works. `oldText` and structured
   * evidence are left out: one must match the stored body, the other is the author's own record.
   */
  const committed = (tool: string, fields: Record<string, unknown>) =>
    Effect.gen(function* () {
      const checkout = (yield* roots).checkout
      const status = yield* processes
        .run(
          ChildProcess.make("git", ["status", "--porcelain", "--untracked-files=all"], {
            cwd: checkout,
            stdin: "ignore",
          }),
        )
        .pipe(
          Effect.map((result) => (result.exitCode === 0 ? result.stdout.toString() : "")),
          Effect.orElseSucceed(() => ""),
        )
      const added = status
        .split("\n")
        .filter((line) => line.startsWith("?? ") || line.startsWith("A "))
        .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
      if (added.length === 0) return
      const text = JSON.stringify(fields, (key, value) => (key === "oldText" || key === "evidence" ? undefined : value))
      const named = added.find((file) =>
        [
          file,
          ...(path.basename(file).includes(".") && path.basename(file).length >= 5 ? [path.basename(file)] : []),
        ].some((name) =>
          new RegExp(`(?<![\\w/.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text),
        ),
      )
      if (named === undefined) return
      return yield* new ToolFailure({
        message: `Nothing was sent: this names ${named}, which only your checkout has: it isn't committed, so no teammate has it. Shared memory records what holds for the repository as committed: leave it out or describe the committed state, then call ${namespace}.${tool} again.`,
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
      const state = tracked(sessionID)
      if ((tool === "rewrite" || tool === "retire") && !state.shown.get(id)?.has(revision))
        return yield* new ToolFailure({
          message: `Nothing was sent: ${tool} acts on the whole of ${id}, so it starts from text you were shown, and this session hasn't been shown r${revision} whole${state.compactions > 0 ? " since the conversation was compacted" : ""}. Call ${namespace}.read with id "${id}", then call ${namespace}.${tool} again with the revision it shows.`,
        })
      // An entry about another repository holds or not there, which this checkout can't show: it isn't replaced or
      // retired from here (an agent once retired another repository's procedure because this one didn't need it).
      const about = state.about.get(id)
      const source = yield* repository
      const here = "repo" in source && source.repo ? repoName(source.repo) : undefined
      if ((tool === "rewrite" || tool === "retire") && about && here && about.toLowerCase() !== here.toLowerCase())
        return yield* new ToolFailure({
          message: `Nothing was sent: ${id} is about ${about}, not this repository (${here}), and what holds there can't be checked from here. Leave it as it is; if it's wrong for this repository too, publish what holds here instead.`,
        })
      const fields = yield* shared(tool, change)
      yield* resolved(tool, Schema.decodeUnknownOption(Paths)(fields.paths).pipe(Option.getOrUndefined))
      if (tool !== "retire") yield* committed(tool, fields)
      const expectedRevision = based(sessionID, id, revision)
      const written = yield* call(
        Written,
        tool === "retire" ? "POST" : "PATCH",
        `/api/memory/entries/${encodeURIComponent(id)}${tool === "retire" ? "/retire" : ""}`,
        // Console's retire takes no provenance.
        tool === "retire"
          ? { expectedRevision, ...fields, ...(yield* reader) }
          : { expectedRevision, ...fields, source: { ...(yield* checkout), sessionID }, ...(yield* reader) },
      )
      wrote(sessionID, id, expectedRevision, written)
      return written
    }).pipe(Effect.mapError(failure))
  // The restricted repositories the workspace has entries for, by workspace: the same list for every member.
  const listed = new Map<string, { readonly at: number; readonly anchors: ReadonlyArray<string> }>()
  /**
   * Which of those this reader can read, checked on this machine with the reader's own GitHub access, as Console names
   * them (`github.com/<id>`): only numeric ids leave the machine. Anything unknown is left out, so Console withholds it.
   */
  const reachable = Effect.gen(function* () {
    const key = current?.console.key ?? ""
    const now = yield* Clock.currentTimeMillis
    const known = listed.get(key)
    const anchors =
      known && now - known.at < ANCHORS_MAX_AGE
        ? known.anchors
        : yield* call(Schema.Struct({ anchors: Schema.Array(Schema.String) }), "GET", "/api/memory/anchors").pipe(
            Effect.map((answer) => answer.anchors),
            Effect.tap((anchors) => Effect.sync(() => listed.set(key, { at: now, anchors }))),
          )
    const ids = anchors.flatMap((anchor) => {
      const match = /^github\.com\/([1-9][0-9]*)$/.exec(anchor)
      return match?.[1] === undefined ? [] : [Number(match[1])]
    })
    return (yield* github.reachable(ids.slice(0, MAX_REACHABLE))).map((id) => `github.com/${id}`)
  }).pipe(Effect.catchCause(() => Effect.succeed(new Array<string>())))
  // The reader's set as a request field; none when it names nothing.
  const reader = reachable.pipe(Effect.map((keys) => (keys.length === 0 ? {} : { reachable: keys })))
  /**
   * The anchor of the checkout's repository, `host/owner/name`, as this machine resolves it now. Without GitHub's numeric
   * id who may read the entry can't be recorded, so nothing is published.
   */
  const anchored = (name: string) =>
    Effect.gen(function* () {
      const anchor = yield* github.anchor(name)
      if (anchor.repoId !== undefined) return { ...anchor, repoId: anchor.repoId }
      return yield* new ToolFailure({
        message:
          anchor.host === "github.com"
            ? `Nothing was sent: this machine couldn't look up ${anchor.name} on GitHub, so who may read the entry can't be recorded. Ask the user to sign in with \`gh auth login\` (or set GH_TOKEN), then call ${namespace}.publish again.`
            : `Nothing was sent: entries from repositories on ${anchor.host} can't be shared yet, since who may read them can't be checked. Keep this in the repository's own docs instead.`,
      })
    })
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

  // The models distillation may run on, in order: the DeepSeek flash models listed (a cheap, capable writer), paid
  // before free, since a free route may refuse a signed-in caller; OpenCode's default model comes after them.
  const distillers = yield* Effect.cached(
    ctx.model.list({ types: ["chat"] }).pipe(
      Effect.map((models) =>
        models.data
          .filter((model) => /deepseek/i.test(model.id) && /flash/i.test(model.id))
          .toSorted((a, b) => Number(/free/i.test(a.id)) - Number(/free/i.test(b.id)))
          .map((model) => ({ id: model.id, providerID: model.providerID })),
      ),
      Effect.orElseSucceed(() => []),
    ),
  )
  // The first of them that answered, tried first from then on.
  let answering: number | undefined

  /**
   * Distils the segment a boundary closed into candidate entries, out of band (a stateless generation, nothing in the
   * coding session), and publishes each that passes the write checks with the segment's evidence. Console holds them
   * provisional until outside evidence backs them; a rule or correction the user stated, in their own words, goes with
   * their confirmation, which makes it live.
   */
  const distill = (
    sessionID: Session.ID,
    segment: ReadonlyArray<OpencodeMemoryCapture.Event>,
    boundary: OpencodeMemoryCapture.Boundary,
    events: { readonly from: number; readonly to: number },
  ) =>
    Effect.gen(function* () {
      const models = yield* distillers
      const state = tracked(sessionID)
      const prompt = OpencodeMemoryCapture.prompt({ segment, boundary, known: known(state) })
      const order = [...(answering === undefined ? [] : [answering]), ...models.keys()].filter(
        (index, at, all) => all.indexOf(index) === at,
      )
      // A listed model can still refuse the request; OpenCode's default model is the last try.
      const answer = yield* Effect.firstSuccessOf([
        ...order.map((index) =>
          ctx.experimental.generate
            .text({ prompt, model: models[index]! })
            .pipe(Effect.tap(() => Effect.sync(() => (answering = index)))),
        ),
        ctx.experimental.generate.text({ prompt }),
      ])
      const found = OpencodeMemoryCapture.candidates(answer.text)
      if (found.length === 0) return
      const source = yield* checkout
      const anchor =
        "repo" in source && source.repo
          ? yield* anchored(source.repo.slice("https://".length)).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
      // Without its repository's id, who may read a candidate from a repository can't be recorded: none is sent.
      if ("repo" in source && source.repo && anchor === undefined) return
      const observed = OpencodeMemoryCapture.evidence(segment)
      yield* Effect.forEach(found, (candidate, index) =>
        Effect.gen(function* () {
          const backing = OpencodeMemoryCapture.backing(candidate, segment)
          if (backing === "dropped")
            return yield* Effect.logDebug("memory candidate dropped: not a rule the user stated", {
              title: candidate.title,
            })
          const evidence = [
            ...observed,
            ...(backing === "confirmed"
              ? [{ kind: "confirmation" as const, ref: (candidate.quote ?? "").trim().slice(0, 500) }]
              : []),
          ]
          // A correction the user confirmed retires what it reverses in the same write; only entries the session knows,
          // of this repository.
          const here = "repo" in source && source.repo ? repoName(source.repo)?.toLowerCase() : undefined
          const supersedes =
            backing === "confirmed"
              ? (candidate.supersedes ?? []).filter(
                  (id) =>
                    state.given.has(id) &&
                    (here === undefined ||
                      state.about.get(id) === undefined ||
                      state.about.get(id)?.toLowerCase() === here),
                )
              : []
          const fields = yield* shared("publish", {
            ...metadata(candidate),
            body: candidate.body,
            ...(evidence.length === 0 ? {} : { evidence }),
          })
          yield* resolved("publish", Schema.decodeUnknownOption(Paths)(fields.paths).pipe(Option.getOrUndefined))
          yield* committed("publish", fields)
          const set = yield* reader
          // A duplicate refusal records this session as having found the same lesson. The user's confirmation goes to the
          // entry that already says it, such as one the agent published itself when the user stated the rule.
          const published = yield* call(Written, "POST", "/api/memory/entries", {
            ...fields,
            ...(supersedes.length === 0 ? {} : { supersedes }),
            source: { ...source, sessionID },
            ...(anchor === undefined ? {} : { anchor }),
            ...(tracked(sessionID).tainted ? { tainted: true } : {}),
            ...set,
            idempotencyKey: `${sessionID}:${boundary}:${events.from}:${index}`.slice(0, 128),
          }).pipe(
            Effect.catch((cause) => {
              const existing = duplicateOf(cause)
              const confirmation = evidence.filter((link) => link.kind === "confirmation")
              if (existing === undefined || confirmation.length === 0) return Effect.fail(cause)
              return call(Schema.Unknown, "POST", `/api/memory/entries/${encodeURIComponent(existing)}/evidence`, {
                evidence: confirmation,
                source: { ...source, sessionID },
                ...set,
              }).pipe(Effect.as(undefined))
            }),
          )
          // The session knows what it published: a later correction can reverse it.
          if (published?.id !== undefined)
            give(state, {
              id: published.id,
              revision: published.revision ?? 1,
              title: candidate.title,
              text: candidate.body,
            })
          supersedes.forEach((id) => state.given.delete(id))
        }).pipe(Effect.catch((cause) => Effect.logDebug("memory candidate not sent", { cause }))),
      )
    }).pipe(Effect.catch((cause) => Effect.logDebug("memory distillation failed", { cause })))

  const start = Effect.fnUntraced(function* () {
    const lease = yield* Scope.Scope
    const capturing = yield* flags.enabled("memory_capture")
    /**
     * Appends `event` to the session's event log, which only this plugin writes and nothing ever rewrites, and, when it
     * closes a work boundary, distils what happened since the last one in the background.
     */
    const record = (sessionID: Session.ID, event: OpencodeMemoryCapture.Event) =>
      Effect.gen(function* () {
        if (!capturing) return
        const state = tracked(sessionID)
        const head = `memory-log-head:${sessionID}`
        const at =
          state.next ?? Option.getOrElse(Schema.decodeUnknownOption(Schema.Int)(yield* ctx.storage.get(head)), () => 0)
        state.next = at + 1
        yield* ctx.storage.set(`memory-log:${sessionID}:${String(at).padStart(10, "0")}`, event)
        yield* ctx.storage.set(head, at + 1)
        const found = OpencodeMemoryCapture.boundary(state.segment, event)
        // A user message closes the turn before it and opens a new one, with a full allowance. A boundary inside the
        // turn past its allowance isn't one: its events stay in the segment for the turn's closing distillation.
        const closing = event.type === "prompt" || found === "compaction"
        if (event.type === "prompt") state.allowance = DISTILLATIONS_PER_TURN
        const boundary = found !== undefined && !closing && state.allowance <= 0 ? undefined : found
        if (boundary !== undefined && !closing) state.allowance--
        // A new task message starts the next segment; every other boundary event ends the one it closes.
        const closes = event.type === "prompt" && boundary === "task" ? [] : [event]
        if (boundary === undefined) {
          if (state.segment.length === 0) state.from = at
          state.segment.push(event)
          if (state.segment.length > MAX_SEGMENT) state.segment.splice(0, state.segment.length - MAX_SEGMENT)
          return
        }
        const segment = [...state.segment, ...closes]
        const events = { from: state.from, to: closes.length === 0 ? at - 1 : at }
        state.segment.splice(0, state.segment.length, ...(closes.length === 0 ? [event] : []))
        state.from = closes.length === 0 ? at : at + 1
        yield* distill(sessionID, segment, boundary, events).pipe(Effect.forkIn(lease, { startImmediately: true }))
      }).pipe(Effect.catch((cause) => Effect.logDebug("failed to record a session event", { cause })))
    // Read now, so the first moment doesn't wait on Git or GitHub.
    yield* repository.pipe(Effect.forkIn(lease, { startImmediately: true }))
    yield* reachable.pipe(Effect.forkIn(lease, { startImmediately: true }))
    // The entries Console gives for a moment the policy picks, within its timeout; none when it picks none or fails.
    const ask = (sessionID: Session.ID, moment: OpencodeMemoryPolicy.Moment) =>
      Effect.gen(function* () {
        const state = tracked(sessionID)
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
        if (!inject) return undefined
        state.injected[moment.type]++
        const answer = yield* reader.pipe(
          Effect.flatMap((set) =>
            call(Schema.Struct({ entries: Schema.Array(Injected) }), "POST", "/api/memory/inject", {
              sessionID,
              moment: moment.type,
              ...inject,
              ...set,
            }),
          ),
          Effect.timeout(policy.timeout),
        )
        // Console injects a revision once per session; a revision the agent already has isn't injected either.
        return answer.entries.filter((entry) => (state.given.get(entry.id)?.revision ?? 0) < entry.revision)
      }).pipe(Effect.catch((cause) => Effect.logDebug("memory injection failed", { cause }).pipe(Effect.as(undefined))))
    // Task start is asked in the background, so the prompt doesn't wait on Console; one at a time per session.
    const begin = (sessionID: Session.ID, moment: OpencodeMemoryPolicy.Moment) =>
      Effect.gen(function* () {
        const state = tracked(sessionID)
        if (state.pending) return
        state.pending = yield* ask(sessionID, moment).pipe(
          Effect.map((entries) => (entries === undefined ? undefined : { entries, moment })),
          Effect.forkIn(lease, { startImmediately: true }),
        )
      })

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const state = tracked(event.sessionID)
        state.task ??= event.prompt.text
        const corrected = policy.correction(event.prompt.text, [...state.given.values()])
        if (corrected) state.nudge = { entry: corrected, messageID: event.messageID }
        yield* record(event.sessionID, {
          type: "prompt",
          text: event.prompt.text.slice(0, MAX_TAIL),
          correction: corrected !== undefined || policy.corrective(event.prompt.text),
        })
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
      const recorded =
        files.length > 0
          ? record(event.sessionID, { type: event.tool === "read" ? "read" : "edit", files })
          : event.tool === "subagent"
            ? record(event.sessionID, { type: "subtask" })
            : Effect.void
      if (
        event.tool === "webfetch" ||
        event.tool === "websearch" ||
        (event.tool === "read" && files.some((file) => path.isAbsolute(file)))
      )
        tracked(event.sessionID).tainted = true
      if (files.length > 0) {
        const state = tracked(event.sessionID)
        files.forEach((file) => {
          if (state.files.includes(file)) state.files.splice(state.files.indexOf(file), 1)
          state.files.push(file)
        })
        state.files.splice(0, Math.max(0, state.files.length - MAX_FILES))
      }
      if (event.tool !== "shell") return recorded
      const shell = Option.all({
        input: Schema.decodeUnknownOption(ShellInput)(event.input),
        output: Schema.decodeUnknownOption(ShellOutput)(event.result.output),
      })
      // A command still running in the background, or one a signal ended, has no exit code yet.
      if (Option.isNone(shell) || shell.value.output.exitCode === null) return Effect.void
      const command = shell.value.input.command
      const exitCode = shell.value.output.exitCode
      if (OUTSIDE.test(command)) tracked(event.sessionID).tainted = true
      const failed = policy.failed(command, shell.value.output.output, exitCode)
      const ran = record(event.sessionID, {
        type: "shell",
        command: command.slice(0, MAX_TAIL),
        exit: exitCode,
        failed,
        test: policy.test(command),
        tail: shell.value.output.output.slice(-MAX_TAIL),
      }).pipe(
        // A commit the session made is a boundary of its own, with its hash as evidence.
        Effect.andThen(
          exitCode === 0 && /\bgit\b[^|;&]*\bcommit\b/.test(command)
            ? head.pipe(Effect.flatMap((sha) => (sha ? record(event.sessionID, { type: "commit", sha }) : Effect.void)))
            : Effect.void,
        ),
      )
      if (!failed) return ran
      const moment = {
        type: "failure" as const,
        command: shell.value.input.command,
        output: shell.value.output.output,
        exitCode: shell.value.output.exitCode,
      }
      // Appended to the failing command's own result, where the agent reads the failure, so it's in the next request
      // without a message of its own. The command's result waits for Console at most the policy's timeout.
      return Effect.gen(function* () {
        yield* ran
        const entries = yield* ask(event.sessionID, moment)
        if (entries === undefined || entries.length === 0) return
        const ids = entries.map((entry) => `${entry.id}@${entry.revision}`)
        event.result = {
          ...event.result,
          content: [
            ...normalizeContent(event.result.content, event.result.output),
            { type: "text", text: `\n${policy.render(entries, moment)}` },
          ],
          metadata: { ...event.result.metadata, memory: { source: "console.memory", moment: "failure", entries: ids } },
        }
        deliver(tracked(event.sessionID), entries)
      })
    })
    // A compaction drops what was injected from the conversation, and the agent's view of entries with it.
    yield* ctx.event.subscribe({ types: ["session.compaction.ended"] }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const state = sessions.get(event.data.sessionID)
          if (!state) return
          state.compactions++
          state.shown.clear()
          if (state.delivered.size > 0) state.redeliver = true
          yield* record(event.data.sessionID, { type: "compaction" })
        }),
      ),
      Effect.forkIn(lease, { startImmediately: true }),
    )
    // The request after a task's first prompt waits for its injection, at most the policy's timeout; the request after a
    // correcting message points out the entry it may correct; the request after a compaction gets the injected entries
    // once more. Other requests find none. They're persisted so later requests keep them, and land after this step, so
    // this request gets them at the end, which keeps the cached prefix.
    /**
     * The session's standing block: its repository's live conventions from Console, chosen and rendered by the policy.
     * Its entries count as given, so injections don't send them again; Console logs the delivery with the session.
     */
    const standing = (sessionID: Session.ID) =>
      Effect.gen(function* () {
        const source = yield* repository
        const name = "repo" in source && source.repo ? repoName(source.repo) : undefined
        if (name === undefined || !("repo" in source) || !source.repo) return ""
        const keys = yield* reachable
        const answer = yield* call(Schema.Struct({ entries: Schema.Array(Standing) }), "POST", "/api/memory/standing", {
          repo: source.repo,
          sessionID,
          ...(keys.length === 0 ? {} : { reachable: keys }),
        }).pipe(Effect.timeout(policy.timeout))
        const block = policy.standing(answer.entries, name)
        if (block.dropped.length > 0)
          yield* Effect.logDebug("memory standing block over its cap", {
            dropped: block.dropped.map((entry) => `${entry.id}@${entry.revision}`),
          })
        if (block.text === undefined) return ""
        const state = tracked(sessionID)
        block.shown.forEach((entry) =>
          give(state, { id: entry.id, revision: entry.revision, title: entry.title, text: entry.body }),
        )
        return block.text
      }).pipe(Effect.catch((cause) => Effect.logDebug("no memory standing block", { cause }).pipe(Effect.as(""))))

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        // Built at the session's first request and carried byte-identical by every request after it, as a system part
        // (never a user message), so the cached prefix stays intact.
        const own = tracked(event.sessionID)
        own.standing ??= yield* standing(event.sessionID)
        if (own.standing) event.system.push(SystemPart.make(own.standing))
        const state = sessions.get(event.sessionID)
        if (!state || (!state.pending && !state.nudge && !state.redeliver)) return
        const pending = state.pending
        const nudge = state.nudge
        state.pending = undefined
        state.nudge = undefined
        if (state.redeliver) {
          state.redeliver = false
          const again = [...state.delivered.values()]
          const text = policy.render(again, { type: "prompt", text: state.task ?? "", files: [] })
          const ids = again.map((entry) => `${entry.id}@${entry.revision}`)
          yield* ctx.session.synthetic({
            sessionID: event.sessionID,
            id: messageID(event.sessionID, `compaction:${state.compactions}`),
            text,
            description: `${ids.length === 1 ? "1 memory entry" : `${ids.length} memory entries`} again after compaction`,
            metadata: { source: "console.memory", moment: "compaction", entries: ids },
            resume: false,
          })
          event.messages.push(Message.user(text))
          again.forEach((entry) => see(state, entry.id, entry.revision))
        }
        const delivery = pending ? yield* Fiber.join(pending) : undefined
        // A failure's delivery may have given an entry since Console answered.
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
          deliver(state, entries)
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
          "Your OpenCode Console workspace's shared memory: what coding agents across the workspace learned about its repositories. Entries are editable: fix one that's wrong, especially when the user corrects it. When search finds no reliable entry, go on without one.",
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
        output: Schema.Struct({
          status: Schema.optional(Schema.Literals(["ok", "no_reliable_entry"])),
          results: Schema.Array(Hit),
        }),
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const checkout = yield* repository
            const files = sessions.get(context.sessionID)?.files ?? []
            const answer = yield* call(
              Schema.Struct({
                status: Schema.optional(Schema.Literals(["ok", "no_reliable_entry"])),
                results: Schema.Array(Hit),
              }),
              "POST",
              "/api/memory/search",
              {
                query: input.query,
                context: {
                  ...("repo" in checkout && checkout.repo !== undefined ? { repo: checkout.repo } : {}),
                  ...(files.length === 0 ? {} : { files }),
                },
                ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                ...(input.limit === undefined ? {} : { limit: input.limit }),
                sessionID: context.sessionID,
                ...(yield* reader),
              },
            )
            return {
              output: answer,
              content:
                answer.status === "no_reliable_entry" || answer.results.length === 0
                  ? "No reliable memory entry found."
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
          reachable.pipe(
            Effect.flatMap((keys) =>
              call(
                Entry,
                "GET",
                `/api/memory/entries/${encodeURIComponent(input.id)}?${new URLSearchParams([
                  ["sessionID", context.sessionID],
                  ...keys.map((key): [string, string] => ["reachable", key]),
                ])}`,
              ),
            ),
            Effect.tap((entry) =>
              Effect.sync(() => {
                const state = tracked(context.sessionID)
                give(state, { id: entry.id, revision: entry.revision, title: entry.title, text: entry.body })
                if (entry.repo && !(entry.tags ?? []).includes("general")) state.about.set(entry.id, entry.repo)
              }),
            ),
            Effect.map((entry) => ({ output: entry, content: show(entry) })),
            Effect.mapError(failure),
          ),
      })
      editor.add({
        name: "publish",
        description: [
          "Most sessions should publish nothing. Publish only one verified, non-obvious finding that an agent on a DIFFERENT task in this repository would need: a fix you verified (a test that failed now passes), a dead end whose cause you found, or a correction the user made. One claim per entry, under ~400 tokens.",
          'Body, every line required (use "Avoid" instead of "Verify" for a don\'t-do-this finding):',
          "Claim: the one fact or rule.",
          "Applies when: the files, versions, commands or error message where it holds; no broader than what you observed.",
          "Action: what to do.",
          "Verify: the command to run and the result to expect. / Avoid: what not to do, and why.",
          "Anchors: the exact paths, symbols, commands or error text it rests on.",
          "Evidence: what you ran in this session and what it showed (failing before, passing after).",
          'Never publish: a repo overview or directory map; task status, progress or a summary of what you changed; what README, AGENTS.md, docs or code comments already say; logs, diffs or config dumps; facts about this machine (what is installed, PATH, local directories); files or settings you added and have not committed; "always/never" rules beyond what you observed. Set paths to the files in Applies when and errors to the exact error messages. If an entry on this subject exists, nothing is published and the answer says which to edit instead.',
        ].join("\n"),
        input: Schema.Struct({
          kind: KindInput,
          title: Schema.String,
          body: Schema.String.annotate({ description: "Markdown" }),
          paths: Schema.optional(Paths),
          errors: Schema.optional(Errors),
          tags: Schema.optional(Tags),
          evidence: Schema.optional(Evidence),
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
            const fields = yield* shared("publish", {
              ...metadata(input),
              body: input.body,
              ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
            })
            yield* resolved("publish", Schema.decodeUnknownOption(Paths)(fields.paths).pipe(Option.getOrUndefined))
            yield* committed("publish", fields)
            const source = yield* checkout
            // The checkout's repository by GitHub's id and visibility, so Console gives the entry only to its readers.
            const anchor =
              "repo" in source && source.repo ? yield* anchored(source.repo.slice("https://".length)) : undefined
            const published = yield* call(Written, "POST", "/api/memory/entries", {
              ...fields,
              ...(input.distinctFrom === undefined ? {} : { distinctFrom: input.distinctFrom }),
              source: { ...source, sessionID: context.sessionID },
              ...(anchor === undefined ? {} : { anchor }),
              // Its session read the web, issue text or another repository: Console never promotes it.
              ...(tracked(context.sessionID).tainted ? { tainted: true } : {}),
              ...(yield* reader),
              idempotencyKey: `${context.sessionID}:${context.id}`.slice(0, 128),
            })
            if (published.id !== undefined)
              give(tracked(context.sessionID), {
                id: published.id,
                revision: published.revision ?? 1,
                title: input.title,
                text: input.body,
              })
            return {
              output: published,
              content: `Published ${published.id} r${published.revision}${published.replayed ? " (this publish was already saved)" : ""}. It's provisional until a teammate backs it: found by search, not handed to sessions.`,
            }
          }).pipe(Effect.mapError(failure)),
      })
      editor.add({
        name: "edit",
        description:
          'Change part of an entry: a fix, a correction, an outdated detail. Copy oldText exactly from the entry\'s current body (no line numbers), unique in it; newText "" deletes it. For several changes pass edits: each oldText is matched against the revision you read, not after the others, and all apply or none. Also changes kind, title, tags, paths or errors, and adds evidence: when you checked that an entry holds, add what you ran and saw pass, which makes a teammate\'s provisional entry live. Pass the revision you read. Fix an entry right away when the user corrects what it says; record what holds for the repository as committed, not your uncommitted changes. Example: {"id":"mem_01","revision":3,"oldText":"npm test","newText":"bun test"}',
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
          evidence: Schema.optional(Evidence),
        }),
        output: Written,
        options: { namespace, codemode: true, pinned: true },
        execute: (input, context) => {
          const pair = input.oldText === undefined ? [] : [{ oldText: input.oldText, newText: input.newText ?? "" }]
          const edits = [...pair, ...(input.edits ?? [])]
          const fields = { ...metadata(input), ...(input.evidence === undefined ? {} : { evidence: input.evidence }) }
          if (edits.length === 0 && Object.keys(fields).length === 0)
            return Effect.fail(
              new ToolFailure({
                message: "edit takes oldText and newText, edits, a new kind, title, tags, paths or errors, or evidence",
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
      listed.clear()
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

/** The entry Console said already holds what a refused publish said, if that's why it was refused. */
function duplicateOf(cause: unknown) {
  if (!(cause instanceof ToolFailure) || cause.metadata?.tag !== "MemoryDuplicate") return undefined
  const candidates = cause.metadata.candidates
  return Array.isArray(candidates) && typeof candidates[0] === "string" ? candidates[0] : undefined
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
          ? "Not found, or not readable with your repository access (or memory is off for this OpenCode Console workspace); retrying won't change that"
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
    `${written.id ?? id} is now r${written.revision}${written.rebasedFrom === undefined ? "" : written.merged ? ` (merged word by word with the changes since r${written.rebasedFrom}: check the diff)` : ` (applied over changes since r${written.rebasedFrom})`}.`,
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
