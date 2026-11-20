export * as OpencodeMemory from "./opencode-memory.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Message, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { Document } from "@opencode/schema/config"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { SessionMessage } from "@opencode/schema/session-message"
import { Hash } from "@opencode/util/hash"
import { AppProcess } from "@opencode/util/process"
import { Clock, Deferred, Effect, Exit, Fiber, Option, Schema, Scope, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ChildProcess } from "effect/process"
import { Config } from "../../config.js"
import { ConfigIntegration } from "../../config/integration.js"
import { Git } from "../../git.js"
import { Integration } from "../../integration.js"
import { AbsolutePath, RelativePath } from "../../schema.js"
import { normalizeContent, normalizedName } from "../../tool/runtime.js"
import { Flag } from "../../flag.js"
import { SessionEnvironment } from "../../session/environment.js"
import { ShellSelect } from "../../shell/select.js"
import { OpencodeMemoryAccess } from "./opencode-memory-access.js"
import { OpencodeMemoryCapture } from "./opencode-memory-capture.js"
import { OpencodeMemoryDecide } from "./opencode-memory-decide.js"
import { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"
import { OpencodeMemoryVerify } from "./opencode-memory-verify.js"
import { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may use the workspace's memory. */
export const header = "x-opencode-memory"
const namespace = "memory"
/** Sessions whose files and injections are remembered; the least recently active is forgotten first. */
const MAX_SESSIONS = 500
const MAX_FILES = 20
/**
 * Entries a session was given that a correction may name, and how much of each is kept: Console's 8 KiB body limit, so
 * an entry is corrected from its whole text.
 */
const MAX_GIVEN = 10
const MAX_GIVEN_TEXT = 8192
/** Events kept since a session's last boundary, newest kept. */
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
/** Commits a session made that it attaches to what it publishes, newest kept. */
const MAX_COMMITS = 10
/**
 * The hidden agent whose model distils candidates; set `agent.memory-writer.model` in config to choose it. Without one,
 * a cheap DeepSeek flash model is used when one is listed, else OpenCode's default model.
 */
const WRITER = Agent.ID.make("memory-writer")
/**
 * The OpenCode Console's own MCP server, as its config names it: tasks and agents from the same workspace memory comes
 * from, so what its tools answer isn't outside input.
 */
const CONSOLE_MCP = "opencode_console"
/**
 * What an injection asks Console for, to judge each candidate itself: Console's top candidates, whatever their score,
 * within the most a token budget Console takes allows, without recording them as delivered; the plugin records what it
 * delivers (`DELIVERIES`). Console that doesn't know `record` records them all, as it did.
 */
const CANDIDATES = { limit: 10, minScore: 0, maxTokens: 20_000, record: false }
/**
 * Asks Console to add the repository's live conventions and procedures, and general ones, to the candidates however they
 * rank, after the ranked ones (`via: "repository"`), up to 20 within the token budget.
 */
const RULES = { includeRepository: true }
/** Where the plugin records the entries it delivered to a session, each at the revision Console gave, once. */
const DELIVERIES = "/api/memory/deliveries"
/** The most entries one injection delivers that apply to the task, failure or action at hand, as Console does. */
const MAX_DELIVERED = 3
/** And at a task's start, the most of the repository's rules for all its work, besides. */
const MAX_RULES = 3
/** The most deliveries one call records, as Console takes them. */
const MAX_RECORDED = 20
/** The instructions source that holds the instruction files: AGENTS.md (or CLAUDE.md) and configured ones. */
const INSTRUCTION_FILES = "core/instructions"
const InstructionsMetadata = Schema.Struct({
  experimental: Schema.Struct({
    instructions: Schema.Array(Schema.Struct({ key: Schema.String, text: Schema.String })),
  }),
})
/** The evidence a fix the plugin re-ran itself carries, with the commit's hash. */
const VERIFIED = "verified-fix"
/** The session instruction entries memory keeps: entries again after a compaction, and a correction reminder. */
const DELIVERED = "memory.delivered"
const CORRECTION = "memory.correction"
/** Per-session state that outlives the process, removed with the session. */
const taintedKey = (sessionID: string) => `memory-tainted:${sessionID}`

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
  /** While its latest revision is pending: the revision still served. */
  liveRevision: Schema.optional(Schema.Number),
})
const Injected = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.Number,
  score: Schema.Number,
  via: Schema.optional(Schema.Literals(["ranking", "repository"])),
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
  status: Schema.optional(Schema.Literals(["live", "provisional"])),
  liveRevision: Schema.optional(Schema.Number),
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
  /**
   * `provisional` while the new revision waits for evidence that it holds, `liveRevision` naming the one still served
   * until then.
   */
  status: Schema.optional(Schema.Literals(["live", "provisional"])),
  liveRevision: Schema.optional(Schema.Number),
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
// Only what the agent can cite: commits are attached by the harness, which saw them made, and CI isn't checked here.
const Evidence = Schema.Array(Schema.Struct({ kind: Schema.Literals(["pr", "test", "command"]), ref: Schema.String }))
  .check(Schema.isMaxLength(10))
  .annotate({
    description:
      "What shows it holds: a test or command you ran and saw pass, or a PR. Recorded with the entry; it doesn't make an entry live by itself",
  })
/** What a finished subagent call answers: the child session it ran in. */
const SubagentMetadata = Schema.Struct({ sessionID: Schema.String })
/** What reading an MCP resource names: the server it comes from. */
const ResourceInput = Schema.Struct({ server: Schema.String })
/** `git commit`, after any global options, as its own command. */
const COMMIT = /(?:^|[;&|(]\s*)git(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+commit\b/m
const PULL_REQUEST = /(?:^|[;&|(]\s*)gh\s+pr\s+create\b/m
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
  /** The latest revision this session wrote of each entry it wrote. */
  readonly edited: Map<string, number>
  /** One event at a time into the session's segment, in the order they happened. */
  readonly order: Semaphore.Semaphore
  /**
   * Per entry, the revisions this session was shown whole since its last compaction: read, injected or written by it.
   * A rewrite or retire replaces what the entry says, so it starts from one of these.
   */
  readonly shown: Map<string, Set<number>>
  /** Entries injected into the session, whole, to deliver once more after a compaction drops them. */
  readonly delivered: Map<string, OpencodeMemoryPolicy.Injected>
  compactions: number
  /** The session's events since its last work boundary. */
  readonly segment: Array<OpencodeMemoryCapture.Event>
  /** What the current user turn still allows for boundaries inside it. */
  allowance: number
  /** Commits the session made, as the harness saw them: evidence for what it publishes. */
  readonly commits: string[]
  /** Files the session wrote with its own edit tools, which aren't outside input when it reads them back. */
  readonly wrote: Set<string>
  /** The current user turn: its commits and test runs, and the observed entries published in it, still unverified. */
  turn: OpencodeMemoryVerify.Turn & {
    readonly commits: string[]
    readonly tests: Array<{ readonly command: string; readonly failed: boolean }>
    readonly pending: Array<{ readonly id: string; readonly revision: number; readonly paths: ReadonlyArray<string> }>
  }
  /** The session took in outside input, so what it writes is marked tainted and never promoted; also stored. */
  tainted?: boolean
  /** The entry the session's correction reminder names, until it's written or a compaction ends. */
  correcting?: string
  /** Its injected entries are in its instructions since a compaction. */
  restated?: boolean
  /** The repository (`host/owner/name`) of each entry the session read, unless it holds anywhere (tagged general). */
  readonly about: Map<string, string>
  task?: string
  /** An injection started at a task's start, waiting for the model request that follows it. */
  pending?: Fiber.Fiber<(Delivery & { readonly moment: Prompted }) | undefined>
  /**
   * The repository's instruction files as the session's first request in this process carries them, "" when it has
   * none: an entry they already state isn't delivered. Later edits to them aren't followed.
   */
  readonly instructions: Deferred.Deferred<string>
  /** The actions held once for the repository's rules for them. */
  readonly acted: Set<"commit" | "pr">
}
type Prompted = Extract<OpencodeMemoryPolicy.Moment, { readonly type: "prompt" }>
/** What a moment delivers: entries for the task, failure or action at hand, and at a task's start the repo's rules. */
type Delivery = {
  readonly entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>
  readonly rules: ReadonlyArray<OpencodeMemoryPolicy.Injected>
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
  const config = yield* Config.Service
  const environments = yield* SessionEnvironment.Service
  const shells = yield* ShellSelect.Service
  const verify = OpencodeMemoryVerify.make({ git, processes, shell: shells.resolve({ priority: "config" }) })
  // The decision model config names under console_memory, the bench's by default, when OpenCode offers it as one; none
  // when config turns decisions off or no provider offers it, and then the judgements that need one are off.
  const decide = OpencodeMemoryDecide.make({
    decisions: ctx.experimental.generate.decisions,
    model: Effect.gen(function* () {
      const setting = Config.latest(yield* config.entries(), "console_memory")
      const chosen = typeof setting === "object" ? setting.decisions : undefined
      if (chosen === false) return undefined
      const model =
        chosen === undefined
          ? OpencodeMemoryDecide.MODEL
          : Model.Ref.make({
              providerID: Provider.ID.make(chosen.providerID),
              id: Model.ID.make(chosen.model),
              ...(chosen.variant === undefined ? {} : { variant: Model.VariantID.make(chosen.variant) }),
            })
      const offered = yield* ctx.model.list({ types: ["decision"] }).pipe(
        Effect.map((answer) => answer.data),
        Effect.orElseSucceed(() => []),
      )
      return offered.some((item) => item.providerID === model.providerID && item.id === model.id) ? model : undefined
    }),
  })
  const github = yield* OpencodeMemoryAccess.make(http, processes, yield* OpencodeMemoryAccess.GitHub)
  let current: { console: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  const sessions = new Map<string, Tracked>()
  const tracked = (sessionID: string): Tracked => {
    const found = sessions.get(sessionID) ?? {
      files: [],
      injected: { prompt: 0, failure: 0 },
      given: new Map(),
      revisions: new Map(),
      edited: new Map(),
      order: Semaphore.makeUnsafe(1),
      shown: new Map(),
      delivered: new Map(),
      compactions: 0,
      segment: [],
      allowance: DISTILLATIONS_PER_TURN,
      commits: [],
      wrote: new Set(),
      turn: { commits: [], tests: [], pending: [] },
      about: new Map(),
      instructions: Deferred.makeUnsafe<string>(),
      acted: new Set(),
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
    state.edited.set(id, written.revision)
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
  /**
   * Marks a session as having taken in outside input, in storage too so it outlives the process, and the sessions
   * that spawned it: what a subagent read reaches its parent with its report.
   */
  const taint = (sessionID: Session.ID): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = tracked(sessionID)
      if (state.tainted) return
      state.tainted = true
      yield* ctx.storage.set(taintedKey(sessionID), true)
      const session = yield* ctx.session.get({ sessionID }).pipe(Effect.option)
      const parent = Option.getOrUndefined(session)?.parentID
      if (parent !== undefined) yield* taint(parent)
    })
  const tainted = (sessionID: Session.ID) =>
    Effect.gen(function* () {
      const state = tracked(sessionID)
      state.tainted ??= (yield* ctx.storage.get(taintedKey(sessionID))) === true || undefined
      return state.tainted === true
    })
  // A correction reminder stays in the session's instructions until the entry it names is written or a compaction
  // ends: it concerns the user's message, and a compacted conversation is restated without it. A note that withdraws
  // it, and only it, takes its place: removing it would tell the agent its context "no longer applies".
  const settle = (sessionID: Session.ID, id?: string) =>
    Effect.gen(function* () {
      const state = tracked(sessionID)
      const correcting = state.correcting
      if (correcting === undefined || (id !== undefined && correcting !== id)) return
      state.correcting = undefined
      yield* ctx.session.instructions.entry.put({ sessionID, key: CORRECTION, value: policy.withdrawn(correcting) })
    }).pipe(Effect.catchCause((cause) => Effect.logDebug("failed to settle a memory correction", { cause })))

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
  // The repository as entries and decisions name it: `host/owner/name`, or the directory's name outside one.
  const label = repository.pipe(
    Effect.map(
      (source) =>
        ("repo" in source && source.repo ? repoName(source.repo) : undefined) ?? path.basename(ctx.location.directory),
    ),
  )
  const discovered = yield* Effect.cached(git.repo.discover(AbsolutePath.make(ctx.location.directory)))
  // Where this machine's paths start, to make what a write says about them shareable.
  const roots = discovered.pipe(
    Effect.map((found) => ({ checkout: found?.worktree ?? ctx.location.directory, home: os.homedir() })),
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

  // The checkout's current commit.
  const head = discovered.pipe(
    Effect.flatMap((found) => (found ? git.history.head(found) : Effect.succeed(undefined))),
    Effect.orElseSucceed(() => undefined),
  )

  /**
   * Refuses a write whose `paths` name a repository path that isn't there. Only clear paths (with a `/`) are checked:
   * globs, dotted module names and root files are taken as given, and git-ignored or generated files pass: a stricter
   * check refuses good entries that name a lockfile, a virtual environment or a module.
   */
  const resolved = (tool: string, paths: ReadonlyArray<string> | undefined) =>
    Effect.gen(function* () {
      const checkout = (yield* roots).checkout
      const absent = yield* Effect.filter(
        (paths ?? []).filter((item) => item.includes("/") && !/[*?[\]{}]/.test(item)),
        (item) =>
          Effect.promise(() =>
            fs.stat(path.join(checkout, item)).then(
              () => false,
              () => true,
            ),
          ),
      )
      if (absent.length === 0) return
      const found = yield* discovered
      const ignored = new Set<string>(
        found
          ? yield* git.index
              .ignored({ repository: found, paths: absent.map((item) => RelativePath.make(item.replace(/\/$/, ""))) })
              .pipe(Effect.orElseSucceed(() => []))
          : [],
      )
      const missing = absent.filter((item) => !ignored.has(item.replace(/\/$/, "")))
      if (missing.length === 0) return
      return yield* new ToolFailure({
        message: `Nothing was sent: paths name ${missing.map((item) => `"${item}"`).join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in the repository. Fix ${missing.length === 1 ? "it" : "them"} to a file or directory that exists, or leave ${missing.length === 1 ? "it" : "them"} out, then call ${namespace}.${tool} again.`,
      })
    })

  /**
   * Refuses a write whose text names a file this checkout added and hasn't committed: no teammate has it, so it says
   * nothing about how the repository works. `oldText` and structured evidence are left out: one must match the stored
   * body, the other is the author's own record.
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
        // Untracked, or added in the index or the worktree (`A `, `AM`, `AD`, ` A`).
        .filter((line) => line.startsWith("??") || line[0] === "A" || line[1] === "A")
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
    sessionID: Session.ID,
    id: string,
    revision: number,
    change: Record<string, unknown>,
    // "user" when the change rests only on the user's own words, which outside input the session took in doesn't touch.
    basis: "session" | "user" = "session",
  ) =>
    Effect.gen(function* () {
      const state = tracked(sessionID)
      if ((tool === "rewrite" || tool === "retire") && !state.shown.get(id)?.has(revision))
        return yield* new ToolFailure({
          message: `Nothing was sent: ${tool} acts on the whole of ${id}, so it starts from text you were shown, and this session hasn't been shown r${revision} whole${state.compactions > 0 ? " since the conversation was compacted" : ""}. Call ${namespace}.read with id "${id}", then call ${namespace}.${tool} again with the revision it shows.`,
        })
      // An entry about another repository holds or not there, which this checkout can't show: it isn't replaced or
      // retired from here, whatever this repository needs.
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
          : {
              expectedRevision,
              ...fields,
              source: { ...(yield* checkout), sessionID },
              // A revision from a session that took in outside input is marked as one, as its publishes are.
              ...(basis === "session" && (yield* tainted(sessionID)) ? { tainted: true } : {}),
              ...(yield* reader),
            },
      )
      wrote(sessionID, id, expectedRevision, written)
      yield* settle(sessionID, id)
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
            Effect.timeout("10 seconds"),
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

  // The models listed for distillation when config names none: the DeepSeek flash models (a cheap, capable writer),
  // paid before free, since a free route may refuse a signed-in caller, then OpenCode's default model.
  const cheap = yield* Effect.cached(
    Effect.all([
      ctx.model.list({ types: ["chat"] }).pipe(
        Effect.map((models) =>
          models.data
            .filter((model) => /deepseek/i.test(model.id) && /flash/i.test(model.id))
            .toSorted((a, b) => Number(/free/i.test(a.id)) - Number(/free/i.test(b.id))),
        ),
        Effect.orElseSucceed(() => []),
      ),
      ctx.model.default().pipe(
        Effect.map((answer) => (answer.data === undefined ? [] : [answer.data])),
        Effect.orElseSucceed(() => []),
      ),
    ]).pipe(
      Effect.map((groups) =>
        groups
          .flat()
          .filter(
            (model, index, all) =>
              all.findIndex((other) => other.id === model.id && other.providerID === model.providerID) === index,
          )
          .map((model) => ({ id: model.id, providerID: model.providerID })),
      ),
    ),
  )
  // The memory writer agent's model when config sets one, and only it; otherwise the listed ones.
  const distillers = ctx.agent.get({ agentID: WRITER }).pipe(
    Effect.map((answer) => answer.data.model),
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((configured) => (configured === undefined ? cheap : Effect.succeed([configured]))),
  )
  // The model that last answered, tried first from then on.
  let answering: string | undefined

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
    turn: Tracked["turn"],
  ) =>
    Effect.gen(function* () {
      // Without a decision model, nothing is captured: no rule, correction or lesson can be judged.
      if (!(yield* decide.available)) return
      const models = yield* distillers
      const state = tracked(sessionID)
      // The entries as the distiller is shown them, which a correction's edits are matched against.
      const shown = [...state.given.values()]
      const prompt = OpencodeMemoryCapture.prompt({ segment, boundary, known: shown })
      const name = (model: { readonly id: string; readonly providerID: string }) => `${model.providerID}/${model.id}`
      // A model can still refuse the request: the next one is tried. With none listed, OpenCode picks its own.
      const answer = yield* Effect.firstSuccessOf(
        models.length === 0
          ? [ctx.experimental.generate.text({ prompt }).pipe(Effect.map((result) => ({ text: result.text })))]
          : models
              .toSorted((a, b) => Number(name(b) === answering) - Number(name(a) === answering))
              .map((model) =>
                ctx.experimental.generate.text({ prompt, model }).pipe(
                  Effect.map((result) => ({ text: result.text, model: name(model) })),
                  Effect.tap((result) => Effect.sync(() => (answering = result.model))),
                ),
              ),
      )
      // The model that wrote a candidate, beside where it was written from.
      const writer = "model" in answer ? { model: answer.model } : {}
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
          // A lesson the work showed goes out only when it's judged durable, not a note about this one task (a decision
          // that fails is a no); a rule the user confirmed is the user's to keep.
          if (backing === "observed") {
            const durable = yield* decide.durable(candidate, yield* label)
            if ((durable ?? 0) < OpencodeMemoryDecide.DURABLE)
              return yield* Effect.logDebug("memory candidate dropped: task-specific", { title: candidate.title })
          }
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
          // A correction of an entry the session holds goes in as a new revision of it, its history kept; one the
          // session edited itself keeps that edit. Only the rest are superseded, by the entry as the correction leaves it.
          const remaining = yield* Effect.filter(supersedes, (id) =>
            correct(sessionID, shown, id, candidate, evidence, { ...source, sessionID, ...writer }).pipe(
              Effect.map((done) => !done),
            ),
          )
          if (supersedes.length > 0 && remaining.length === 0) return
          const original = remaining.length === 1 ? shown.find((entry) => entry.id === remaining[0]) : undefined
          const body =
            (original && candidate.edits && OpencodeMemoryCapture.corrected(original.text, candidate.edits)) ??
            candidate.body
          const fields = yield* shared("publish", {
            ...metadata(candidate),
            body,
            ...(evidence.length === 0 ? {} : { evidence }),
          })
          yield* resolved("publish", Schema.decodeUnknownOption(Paths)(fields.paths).pipe(Option.getOrUndefined))
          yield* committed("publish", fields)
          const set = yield* reader
          // A duplicate refusal records this session as having found the same lesson. The user's confirmation goes to the
          // entry that already says it, such as one the agent published itself when the user stated the rule.
          const published = yield* call(Written, "POST", "/api/memory/entries", {
            ...fields,
            ...(remaining.length === 0 ? {} : { supersedes: remaining }),
            source: { ...source, sessionID, ...writer },
            ...(anchor === undefined ? {} : { anchor }),
            // A rule the user confirmed in their own words rests on them, not on what else the session read.
            ...(backing !== "confirmed" && (yield* tainted(sessionID)) ? { tainted: true } : {}),
            ...set,
            // Keyed by what was distilled: no two distillations share a key, before a restart or after it.
            idempotencyKey: `${sessionID}:${boundary}:${Hash.sha256(prompt).slice(0, 16)}:${index}`.slice(0, 128),
          }).pipe(
            Effect.catch((cause) => {
              const existing = duplicateOf(cause)
              const confirmation = evidence.filter((link) => link.kind === "confirmation")
              if (existing === undefined || confirmation.length === 0) return Effect.fail(cause)
              return call(Schema.Unknown, "POST", `/api/memory/entries/${encodeURIComponent(existing)}/evidence`, {
                evidence: confirmation,
                source: { ...source, sessionID, ...writer },
                ...set,
              }).pipe(Effect.as(undefined))
            }),
          )
          // An observed claim the session can back itself waits for this turn's commit and test to be re-run.
          if (published?.id !== undefined && backing === "observed")
            turn.pending.push({
              id: published.id,
              revision: published.revision ?? 1,
              paths: Option.getOrElse(Schema.decodeUnknownOption(Paths)(fields.paths), () => []),
            })
          // The session knows what it published: a later correction can reverse it.
          if (published?.id !== undefined)
            give(state, {
              id: published.id,
              revision: published.revision ?? 1,
              title: candidate.title,
              text: body,
            })
          remaining.forEach((id) => state.given.delete(id))
        }).pipe(Effect.catch((cause) => Effect.logDebug("memory candidate not sent", { cause }))),
      )
    }).pipe(Effect.catch((cause) => Effect.logDebug("memory distillation failed", { cause })))

  /**
   * Applies a correction the user confirmed to entry `id` as a new revision of it, from the revision the distiller was
   * shown: true when it's in, or when the session already edited the entry itself (that edit stands, backed by the
   * user's confirmation), false when the entry has to be superseded instead.
   */
  const correct = (
    sessionID: Session.ID,
    shown: ReadonlyArray<OpencodeMemoryPolicy.Given>,
    id: string,
    candidate: OpencodeMemoryCapture.Candidate,
    evidence: ReadonlyArray<{ readonly kind: string; readonly ref: string }>,
    source: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      const entry = shown.find((item) => item.id === id)
      if (entry === undefined) return false
      const edits = candidate.edits ?? []
      // A corrected fact the title states too changes there in the same patch.
      const title = edits
        .filter((edit) => edit.oldText !== "" && entry.title.split(edit.oldText).length === 2)
        .reduce((current, edit) => current.replace(edit.oldText, () => edit.newText), entry.title)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)
      const retitled = title !== entry.title && title !== "" ? { title } : {}
      return yield* (
        edits.length > 0
          ? write("edit", sessionID, id, entry.revision, { edits, ...retitled, evidence }, "user")
          : write("rewrite", sessionID, id, entry.revision, { body: candidate.body, evidence }, "user")
      ).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logDebug("memory correction not applied as an edit", { id, cause })
            const revision = tracked(sessionID).edited.get(id)
            if (revision === undefined) return false
            // The session's own edit made the correction, without evidence, which leaves that revision unbacked: the
            // user's confirmation backs the revision it wrote, with no revision of its own.
            const confirmation = evidence.filter((link) => link.kind === "confirmation")
            if (confirmation.length > 0)
              yield* call(Schema.Unknown, "POST", `/api/memory/entries/${encodeURIComponent(id)}/evidence`, {
                evidence: confirmation,
                revision,
                source,
                ...(yield* reader),
              }).pipe(Effect.catch((cause) => Effect.logDebug("memory confirmation not sent", { id, cause })))
            return true
          }),
        ),
      )
    })

  const start = Effect.fnUntraced(function* () {
    const lease = yield* Scope.Scope
    const capturing = yield* flags.enabled("memory_capture")
    // The agent whose model distillation runs on, which config may set.
    yield* ctx.agent.transform((editor) =>
      editor.update(WRITER, (agent) => {
        agent.name = Agent.Name.make("Memory writer")
        agent.description =
          "Distils what coding sessions learned into candidate entries for the workspace's shared memory. Set its model to choose the one that writes them."
        agent.mode = "primary"
        agent.hidden = true
      }),
    )
    /**
     * Adds `event` to the session's segment and, when it closes a work boundary, distils the segment in the background.
     * Kept in memory only: a restart loses the open segment, never anything published.
     */
    const record = (sessionID: Session.ID, event: OpencodeMemoryCapture.Event) =>
      tracked(sessionID).order.withPermit(recorded(sessionID, event, tracked(sessionID).turn))
    /** `record` for a caller that holds the session's order; `turn` is the user turn the event belongs to. */
    const recorded = (sessionID: Session.ID, event: OpencodeMemoryCapture.Event, turn: Tracked["turn"]) =>
      Effect.gen(function* () {
        if (!capturing) return
        const state = tracked(sessionID)
        const found = OpencodeMemoryCapture.boundary(state.segment, event)
        // A user message closes the turn before it and opens a new one, with a full allowance. A boundary inside the
        // turn past its allowance isn't one: its events stay in the segment for the turn's closing distillation.
        const closing = event.type === "prompt" || found === "compaction"
        if (event.type === "prompt") state.allowance = DISTILLATIONS_PER_TURN
        const boundary = found !== undefined && !closing && state.allowance <= 0 ? undefined : found
        if (boundary !== undefined && !closing) state.allowance--
        if (boundary === undefined) {
          state.segment.push(event)
          if (state.segment.length > MAX_SEGMENT) state.segment.splice(0, state.segment.length - MAX_SEGMENT)
          return
        }
        // A new task message starts the next segment; every other boundary event ends the one it closes.
        const opens = event.type === "prompt" && boundary === "task"
        const segment = opens ? [...state.segment] : [...state.segment, event]
        state.segment.splice(0, state.segment.length, ...(opens ? [event] : []))
        yield* distill(sessionID, segment, boundary, turn).pipe(
          Effect.andThen(attempt(sessionID, turn)),
          Effect.forkIn(lease, { startImmediately: true }),
        )
      })
    /**
     * Re-runs, in the background, the fix behind each observed entry the session published this turn, once the turn
     * shows a commit that changed its files and a test that failed, then passed; one that holds gets the evidence,
     * which Console promotes on. Never for a session that took in outside input.
     */
    const attempt = (sessionID: Session.ID, turn: Tracked["turn"]) =>
      Effect.gen(function* () {
        const found = yield* discovered
        if (turn.pending.length === 0 || !found || (yield* tainted(sessionID))) return
        const env = (yield* environments.get(sessionID)) ?? process.env
        yield* Effect.forEach(
          [...turn.pending],
          (entry) =>
            Effect.gen(function* () {
              const sha = yield* verify({ repository: found, turn, paths: entry.paths, env })
              if (sha === undefined) return
              turn.pending.splice(turn.pending.indexOf(entry), 1)
              if (sha === false) return
              yield* call(Schema.Unknown, "POST", `/api/memory/entries/${encodeURIComponent(entry.id)}/evidence`, {
                evidence: [{ kind: VERIFIED, ref: sha }],
                revision: entry.revision,
                source: { ...(yield* checkout), sessionID },
                ...(yield* reader),
              })
            }),
          { discard: true },
        )
      }).pipe(Effect.catchCause((cause) => Effect.logDebug("memory fix not verified", { cause })))
    // Read now, so the first moment doesn't wait on Git or GitHub.
    yield* repository.pipe(Effect.forkIn(lease, { startImmediately: true }))
    yield* reachable.pipe(Effect.forkIn(lease, { startImmediately: true }))
    // The MCP servers whose tools and resources are outside input, by tool prefix and name: all but the Console's own,
    // while the server config ends up with under its name is the one the Console delivered rather than one of the user's.
    const servers = yield* Effect.cachedWithTTL(
      Effect.all([ctx.mcp.list(), config.entries()]).pipe(
        Effect.map(([answer, entries]) => {
          const delivered = entries.findLast(
            (entry): entry is Document =>
              entry.type === "document" && entry.info.mcp?.servers?.[CONSOLE_MCP] !== undefined,
          )
          const own =
            delivered instanceof ConfigIntegration.Document &&
            delivered.integrationID === Integration.ID.make("opencode")
          return answer.data
            .map((server) => normalizedName({ name: server.name }))
            .filter((name) => !(own && name === CONSOLE_MCP))
        }),
        Effect.orElseSucceed(() => new Array<string>()),
      ),
      "1 minute",
    )
    /**
     * Whether a completed tool call took in outside input: the web, an MCP server other than the Console's own, or a
     * read past the checkout or of a file the repository doesn't track that the session didn't write itself, such as a
     * download. What a command printed is local output and never is.
     */
    const outside = (event: { tool: string; input: unknown; sessionID: Session.ID }, files: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const outsiders = yield* servers
        if (event.tool === "webfetch" || event.tool === "websearch") return true
        if (outsiders.some((name) => event.tool.startsWith(`${name}_`))) return true
        if (event.tool === "opencode_read_mcp_resource")
          return Option.match(Schema.decodeUnknownOption(ResourceInput)(event.input), {
            onNone: () => true,
            onSome: (input) =>
              normalizedName({ name: input.server }) !== CONSOLE_MCP || outsiders.includes(CONSOLE_MCP),
          })
        if (event.tool !== "read") return false
        if (files.some((file) => path.isAbsolute(file))) return true
        const state = tracked(event.sessionID)
        const found = yield* discovered
        const unwritten = files.filter((file) => !state.wrote.has(file))
        if (!found || unwritten.length === 0) return false
        const paths = unwritten.map((file) =>
          RelativePath.make(
            path.relative(found.worktree, path.join(ctx.location.directory, file)).split(path.sep).join("/"),
          ),
        )
        const known = yield* git.index
          .tracked({ repository: found, paths })
          .pipe(Effect.orElseSucceed(() => new Set(paths)))
        return paths.some((item) => !known.has(item))
      })
    // HEAD when a `git commit` started, by tool call, to tell whether it made one.
    const heads = new Map<string, string | undefined>()
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
        // With a decision model, Console's candidates, each judged (a decision that fails is a no); without one, what
        // Console's own scoring hands out. A revision the agent already has isn't delivered again.
        const gated = yield* decide.available
        const task = moment.type === "prompt" ? moment.text : (state.task ?? moment.command)
        return yield* reader.pipe(
          Effect.flatMap((set) =>
            call(Schema.Struct({ entries: Schema.Array(Injected) }), "POST", "/api/memory/inject", {
              sessionID,
              moment: moment.type,
              ...inject,
              ...(gated ? { ...CANDIDATES, ...(moment.type === "failure" ? {} : RULES) } : {}),
              ...set,
            }),
          ),
          Effect.map((answer) =>
            answer.entries.filter((entry) => (state.given.get(entry.id)?.revision ?? 0) < entry.revision),
          ),
          Effect.flatMap((entries) =>
            gated
              ? select(state, moment, task, entries)
              : Effect.succeed<Delivery>({ entries: entries.slice(0, MAX_DELIVERED), rules: [] }),
          ),
          Effect.timeout(policy.timeout),
        )
      }).pipe(Effect.catch((cause) => Effect.logDebug("memory injection failed", { cause }).pipe(Effect.as(undefined))))
    /**
     * The judged candidates a moment delivers, best first: those that apply to the task, failure or action at hand, and
     * at a task's start the repository's rules for all its work besides, each within its own budget. Of those, the ones
     * the repository's instruction files already state are left out.
     */
    const select = (
      state: Tracked,
      moment: OpencodeMemoryPolicy.Moment,
      task: string,
      entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>,
    ) =>
      Effect.gen(function* () {
        // At a task's start each candidate is asked whether it's a rule for all the repository's work, and a ranked one
        // whether it applies to the task too; elsewhere only whether it applies.
        const name = yield* label
        const judged = yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.all(
              {
                applies:
                  moment.type === "prompt" && entry.via === "repository"
                    ? Effect.succeed(undefined)
                    : decide.applies(moment, task, entry),
                repo: moment.type === "prompt" ? decide.repoWide(entry, name) : Effect.succeed(undefined),
              },
              { concurrency: 2 },
            ).pipe(Effect.map((p) => ({ entry, ...p }))),
          { concurrency: 4 },
        )
        const rules =
          moment.type === "prompt"
            ? judged
                .filter((item) => (item.repo ?? 0) >= OpencodeMemoryDecide.REPO_WIDE)
                .toSorted((a, b) => (b.repo ?? 0) - (a.repo ?? 0))
            : []
        const applying = judged
          .filter((item) => !rules.includes(item) && (item.applies ?? 0) >= OpencodeMemoryDecide.APPLIES)
          .toSorted((a, b) => (b.applies ?? 0) - (a.applies ?? 0))
        if (rules.length === 0 && applying.length === 0) return { entries: [], rules: [] } satisfies Delivery
        const instructions = yield* Deferred.await(state.instructions)
        const [fitting, kept] = yield* Effect.all(
          [
            unstated(
              applying.map((item) => item.entry),
              MAX_DELIVERED,
              instructions,
            ),
            unstated(
              rules.map((item) => item.entry),
              MAX_RULES,
              instructions,
            ),
          ],
          { concurrency: 2 },
        )
        return { entries: fitting, rules: kept } satisfies Delivery
      })
    /**
     * Up to `budget` of `entries`, in order, that the instruction files don't already state, asking only as many at a
     * time as the budget still has room for (a decision that fails is a no). All of them up to it when there are none.
     */
    const unstated = (
      entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>,
      budget: number,
      instructions: string,
    ): Effect.Effect<ReadonlyArray<OpencodeMemoryPolicy.Injected>> =>
      instructions === "" || budget <= 0 || entries.length === 0
        ? Effect.succeed(entries.slice(0, Math.max(0, budget)))
        : Effect.forEach(
            entries.slice(0, budget),
            (entry) => decide.stated(instructions, entry).pipe(Effect.map((stated) => ({ entry, stated }))),
            { concurrency: budget },
          ).pipe(
            Effect.flatMap((judged) => {
              const fresh = judged.filter((item) => item.stated === false).map((item) => item.entry)
              return unstated(entries.slice(budget), budget - fresh.length, instructions).pipe(
                Effect.map((rest) => [...fresh, ...rest]),
              )
            }),
          )
    // Console records each delivered revision once, so what its own scoring handed out and already recorded isn't
    // recorded twice.
    // The reader's reachable set goes with them, as Console needs it for an entry of a repository that isn't public.
    const report = (sessionID: Session.ID, entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>) =>
      reader.pipe(
        Effect.flatMap((set) =>
          call(Schema.Unknown, "POST", DELIVERIES, {
            sessionID,
            entries: entries.slice(0, MAX_RECORDED).map((entry) => ({ id: entry.id, revision: entry.revision })),
            ...set,
          }),
        ),
        Effect.catch((cause) => Effect.logDebug("memory delivery not recorded", { cause })),
        Effect.forkIn(lease, { startImmediately: true }),
      )
    // Task start is asked in the background, so the prompt doesn't wait on Console; one at a time per session.
    const begin = (sessionID: Session.ID, moment: Prompted) =>
      Effect.gen(function* () {
        const state = tracked(sessionID)
        if (state.pending) return
        state.pending = yield* ask(sessionID, moment).pipe(
          Effect.map((delivery) => (delivery === undefined ? undefined : { ...delivery, moment })),
          Effect.forkIn(lease, { startImmediately: true }),
        )
      })
    // Points out the given entry the user's message may correct, as a session instruction: the next request carries
    // it as an instruction update, recorded with the session, and the cached prefix holds.
    const remind = (sessionID: Session.ID, given: OpencodeMemoryPolicy.Given) =>
      Effect.gen(function* () {
        const state = tracked(sessionID)
        const entry = state.given.get(given.id) ?? given
        yield* ctx.session.instructions.entry.put({ sessionID, key: CORRECTION, value: policy.nudge(entry) })
        state.correcting = entry.id
      }).pipe(Effect.catchCause((cause) => Effect.logDebug("failed to point out a memory correction", { cause })))

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const state = tracked(event.sessionID)
        state.task ??= event.prompt.text
        // Only the user's own prompts are their word: what they typed, or a command they chose to run. A subagent's task
        // comes from its parent's model and an automation's from its schedule or trigger. Only the user's word confirms
        // an entry, states a rule or reads as a correction.
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.option)
        const user =
          Option.isSome(session) && session.value.parentID === undefined && event.metadata?.automation === undefined
        const text = event.prompt.text
        const given = [...state.given.values()]
        // The distillation this message starts has the turn it closes; a new one begins.
        const closed = state.turn
        state.turn = { commits: [], tests: [], pending: [] }
        // Judged off the prompt's path, when a decision model resolves: whether it states a lasting rule, and which given
        // entry it corrects. A decision that fails is a no. The session's later events wait for it, so the segment keeps
        // their order.
        yield* state.order
          .withPermit(
            Effect.gen(function* () {
              const [lasting, corrected] =
                user && (yield* decide.available)
                  ? yield* Effect.all(
                      [
                        decide.lasting(text),
                        given.length > 0 ? decide.corrects(text, given) : Effect.succeed(undefined),
                      ],
                      { concurrency: 2 },
                    )
                  : [undefined, undefined]
              const rule = (lasting ?? 0) >= OpencodeMemoryDecide.LASTING
              const entry =
                corrected?.id !== undefined && corrected.p >= OpencodeMemoryDecide.CORRECTS
                  ? given.find((item) => item.id === corrected.id)
                  : undefined
              yield* recorded(
                event.sessionID,
                {
                  type: "prompt",
                  text: text.slice(0, MAX_TAIL),
                  correction: entry !== undefined || rule,
                  user,
                  lasting: rule,
                },
                closed,
              )
              if (entry) yield* remind(event.sessionID, entry)
            }),
          )
          .pipe(Effect.forkIn(lease, { startImmediately: true }))
        yield* begin(event.sessionID, {
          type: "prompt",
          text: event.prompt.text,
          files: (event.prompt.files ?? []).flatMap((file) =>
            file.uri.startsWith("file:") ? [relative(ctx.location.directory, fileURLToPath(file.uri))] : [],
          ),
        })
      }),
    )
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        // Models carry other editors' names for an edit's texts; they mean these.
        if (event.tool === `${namespace}_edit` && typeof event.input === "object" && event.input !== null)
          event.input = aliased(event.input)
        if (event.tool !== "shell") return
        const shell = Schema.decodeUnknownOption(ShellInput)(event.input)
        if (Option.isNone(shell)) return
        const command = shell.value.command
        const action = COMMIT.test(command)
          ? ("commit" as const)
          : PULL_REQUEST.test(command)
            ? ("pr" as const)
            : undefined
        const state = tracked(event.sessionID)
        // A session's first commit and first pull request are held once, when the decision model finds rules of the
        // repository's for them, so the agent reads them before acting: as the call's error, run again after it.
        if (action !== undefined && !state.acted.has(action) && (yield* decide.available)) {
          state.acted.add(action)
          const moment = { type: "action" as const, action, command }
          const entries = (yield* ask(event.sessionID, moment))?.entries
          if (entries !== undefined && entries.length > 0) {
            deliver(state, entries)
            yield* report(event.sessionID, entries)
            return yield* new Tool.Error({ message: policy.held(entries, moment) })
          }
        }
        if (action === "commit") heads.set(event.id, yield* head)
      }),
    )
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        const committing = heads.has(event.id)
        const before = heads.get(event.id)
        heads.delete(event.id)
        if (event.status !== "completed") return
        // The checkout's root names no file of it to remember.
        const files = touched(event.tool, event.input)
          .map((file) => relative(ctx.location.directory, file))
          .filter((file) => file !== ".")
        const fromOutside = yield* outside(event, files)
        if (files.length > 0)
          yield* record(
            event.sessionID,
            event.tool === "read"
              ? { type: "read", files, ...(fromOutside ? { outside: true } : {}) }
              : { type: "edit", files },
          )
        if (event.tool === "subagent") {
          // A subagent that took in outside input has tainted this session too, through its parent.
          const child = Schema.decodeUnknownOption(SubagentMetadata)(event.result.metadata)
          const read = Option.isSome(child) && (yield* tainted(Session.ID.make(child.value.sessionID)))
          yield* record(event.sessionID, { type: "subtask", ...(read ? { outside: true } : {}) })
        }
        if (event.tool !== "read") files.forEach((file) => tracked(event.sessionID).wrote.add(file))
        if (fromOutside) yield* taint(event.sessionID)
        if (files.length > 0) {
          const state = tracked(event.sessionID)
          files.forEach((file) => {
            if (state.files.includes(file)) state.files.splice(state.files.indexOf(file), 1)
            state.files.push(file)
          })
          state.files.splice(0, Math.max(0, state.files.length - MAX_FILES))
        }
        if (event.tool !== "shell") return
        const shell = Option.all({
          input: Schema.decodeUnknownOption(ShellInput)(event.input),
          output: Schema.decodeUnknownOption(ShellOutput)(event.result.output),
        })
        // A command still running in the background, or one a signal ended, has no exit code yet.
        if (Option.isNone(shell) || shell.value.output.exitCode === null) return
        const command = shell.value.input.command
        const exitCode = shell.value.output.exitCode
        const failed = policy.failed(command, shell.value.output.output, exitCode)
        if (policy.test(command)) tracked(event.sessionID).turn.tests.push({ command, failed })
        yield* record(event.sessionID, {
          type: "shell",
          command: command.slice(0, MAX_TAIL),
          exit: exitCode,
          failed,
          test: policy.test(command),
          tail: shell.value.output.output.slice(-MAX_TAIL),
        })
        // A commit the session made, when `git commit` moved HEAD, is a boundary of its own with its hash as evidence.
        const sha = committing && exitCode === 0 ? yield* head : undefined
        if (sha !== undefined && sha !== before) {
          const state = tracked(event.sessionID)
          state.commits.push(sha)
          state.commits.splice(0, Math.max(0, state.commits.length - MAX_COMMITS))
          state.turn.commits.push(sha)
          yield* record(event.sessionID, { type: "commit", sha })
          yield* attempt(event.sessionID, state.turn).pipe(Effect.forkIn(lease, { startImmediately: true }))
        }
        if (!failed) return
        const moment = { type: "failure" as const, command, output: shell.value.output.output, exitCode }
        // Appended to the failing command's own result, where the agent reads the failure, so it's in the next request
        // without a message of its own. The command's result waits for Console at most the policy's timeout.
        const entries = (yield* ask(event.sessionID, moment))?.entries
        if (entries === undefined || entries.length === 0) return
        yield* report(event.sessionID, entries)
        const ids = entries.map((entry) => `${entry.id}@${entry.revision}`)
        event.result = {
          ...event.result,
          content: [
            ...normalizeContent(event.result.content, event.result.output),
            { type: "text", text: `\n${policy.render(entries, moment)}` },
          ],
          metadata: { ...event.result.metadata, memory: { source: "console.memory", moment: "failure", entries: ids } },
        }
        const state = tracked(event.sessionID)
        state.injected.failure++
        deliver(state, entries)
      }).pipe(Effect.catchCause((cause) => Effect.logDebug("memory missed a tool call", { cause }))),
    )
    // A compaction drops what was injected from the conversation, and the agent's view of entries with it. The injected
    // entries go into the session's instructions, which a compacted conversation is restated with.
    yield* ctx.event.subscribe({ types: ["session.compaction.ended"] }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          const state = sessions.get(sessionID)
          if (!state) return
          state.compactions++
          state.shown.clear()
          yield* settle(sessionID)
          yield* record(sessionID, { type: "compaction" })
          if (state.delivered.size === 0) {
            if (state.restated) yield* ctx.session.instructions.entry.remove({ sessionID, key: DELIVERED })
            state.restated = false
            return
          }
          const again = [...state.delivered.values()]
          yield* ctx.session.instructions.entry.put({
            sessionID,
            key: DELIVERED,
            value: policy.render(again, { type: "prompt", text: state.task ?? "", files: [] }),
          })
          state.restated = true
          again.forEach((entry) => see(state, entry.id, entry.revision))
        }).pipe(Effect.catchCause((cause) => Effect.logDebug("failed to restate memory entries", { cause }))),
      ),
      Effect.forkIn(lease, { startImmediately: true }),
    )
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        // The request after a task's first prompt waits for its injection, at most the policy's timeout. It's persisted
        // so later requests keep it, and lands after this step, so this request gets it at the end, which keeps the
        // cached prefix.
        const state = tracked(event.sessionID)
        yield* Deferred.succeed(
          state.instructions,
          event.system
            .flatMap((part) =>
              Option.match(Schema.decodeUnknownOption(InstructionsMetadata)(part.metadata), {
                onNone: () => [],
                onSome: (metadata) => metadata.experimental.instructions,
              }),
            )
            .filter((source) => source.key === INSTRUCTION_FILES)
            .map((source) => source.text)
            .join("\n\n"),
        )
        const pending = state.pending
        if (!pending) return
        state.pending = undefined
        const delivery = yield* Fiber.join(pending)
        // A failure's delivery may have given an entry since Console answered.
        const fresh = (entries: ReadonlyArray<OpencodeMemoryPolicy.Injected>) =>
          entries.filter((entry) => (state.given.get(entry.id)?.revision ?? 0) < entry.revision)
        const rules = fresh(delivery?.rules ?? [])
        const entries = fresh(delivery?.entries ?? [])
        if (!delivery || rules.length + entries.length === 0) return
        yield* report(event.sessionID, [...rules, ...entries])
        // The repository's rules first, in an instruction file's form, then the entries for the task in memory's own.
        const messages = [
          ...(rules.length === 0
            ? []
            : [
                {
                  delivered: rules,
                  text: policy.conventions(rules, yield* label),
                  description: `${rules.length === 1 ? "1 repository convention" : `${rules.length} repository conventions`}`,
                  form: "instructions",
                },
              ]),
          ...(entries.length === 0
            ? []
            : [
                {
                  delivered: entries,
                  text: policy.render(entries, delivery.moment),
                  description: `${entries.length === 1 ? "1 memory entry" : `${entries.length} memory entries`} for this task`,
                  form: "entries",
                },
              ]),
        ]
        yield* Effect.forEach(messages, (message) => {
          const ids = message.delivered.map((entry) => `${entry.id}@${entry.revision}`)
          event.messages.push(Message.user(message.text))
          return ctx.session.synthetic({
            sessionID: event.sessionID,
            id: messageID(event.sessionID, ids.join(",")),
            text: message.text,
            description: message.description,
            metadata: { source: "console.memory", moment: delivery.moment.type, form: message.form, entries: ids },
            resume: false,
          })
        })
        state.injected[delivery.moment.type]++
        deliver(state, [...rules, ...entries])
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
            // With the commits the session made, as the harness saw them.
            const evidence = [
              ...(input.evidence ?? []),
              ...tracked(context.sessionID).commits.map((sha) => ({ kind: "commit" as const, ref: sha })),
            ]
            const fields = yield* shared("publish", {
              ...metadata(input),
              body: input.body,
              ...(evidence.length === 0 ? {} : { evidence }),
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
              // Its session read the web, issue text, an MCP server or another repository: Console never promotes it.
              ...((yield* tainted(context.sessionID)) ? { tainted: true } : {}),
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
          'Change part of an entry: a fix, a correction, an outdated detail. Copy oldText exactly from the entry\'s current body (no line numbers), unique in it; newText "" deletes it. For several changes pass edits: each oldText is matched against the revision you read, not after the others, and all apply or none. Also changes kind, title, tags, paths or errors, and adds evidence: when you checked that an entry holds, add what you ran and saw pass; it\'s recorded with the entry, and doesn\'t make a provisional one live by itself. Pass the revision you read. Fix an entry right away when the user corrects what it says; record what holds for the repository as committed, not your uncommitted changes. Example: {"id":"mem_01","revision":3,"oldText":"npm test","newText":"bun test"}',
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

  // What memory keeps for a session goes when the session is deleted; an archived one may be resumed, so it stays.
  yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        sessions.delete(event.data.sessionID)
        yield* ctx.storage.remove(taintedKey(event.data.sessionID))
      }),
    ),
    Effect.forkIn(scope, { startImmediately: true }),
  )

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
  // The directory itself is inside it, as ".".
  if (inside === "") return "."
  return !inside.startsWith("..") && !path.isAbsolute(inside) ? inside : file
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
    `${written.id ?? id} is now r${written.revision}${written.rebasedFrom === undefined ? "" : written.merged ? ` (merged word by word with the changes since r${written.rebasedFrom}: check the diff)` : ` (applied over changes since r${written.rebasedFrom})`}.${pending(written) ?? ""}`,
    ...(written.changesSince === undefined ? [] : [`Changes since r${written.rebasedFrom}:`, written.changesSince]),
    ...(written.matched?.includes("fuzzy") ? ["An oldText matched only approximately: check the diff."] : []),
    ...(written.warnings ?? []).map((warning) => `Warning: ${warning}`),
    ...(written.diff ? [written.diff] : []),
  ].join("\n")
}

/** What a pending revision's answer, hit or entry says about it: the revision still in use until evidence backs it. */
function pending(item: { readonly status?: string; readonly liveRevision?: number }) {
  if (item.status !== "provisional" || item.liveRevision === undefined) return undefined
  return ` It's pending, revision ${item.liveRevision} is still in use.`
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
    entry.status === "provisional" &&
      entry.liveRevision !== undefined &&
      `pending, revision ${entry.liveRevision} is still in use`,
  ]
  const errors = entry.errors && entry.errors.length > 0 ? `\nErrors: ${entry.errors.join(" | ")}` : ""
  const retired = entry.retired
    ? `\nRetired ${entry.retired.at.slice(0, 10)}: ${entry.retired.reason}${entry.retired.supersededBy ? ` (superseded by ${entry.retired.supersededBy})` : ""}`
    : ""
  return `${about.filter(Boolean).join(" · ")}${errors}${retired}\n# ${entry.title}\n\n${entry.body}`
}
