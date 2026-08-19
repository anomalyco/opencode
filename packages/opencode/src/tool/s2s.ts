// Session-to-Session — Task 7 (the s2s tool).
//
// This is the user-facing primitive for cross-session messaging between
// two SEPARATE top-level opencode sessions (siblings, not parent/child
// subagents — that path stays on the existing `message` tool). The two
// sessions live in the same machine (the s2s_inbox table is a per-host
// SQLite file) and must opt in to each other via an `invite` / `accept`
// token handshake before they can exchange messages.
//
// Commands:
//   - invite           — mint a single-use token bound to this session.
//   - accept <token>   — consume a peer's token; writes both allow
//                        directions in the durable consent record.
//   - msg <session-id> <body> — send a body to an allow-listed peer
//                        (addressed by the peer's globally-unique
//                        session_id); goes in-process when the peer is
//                        local and persists to s2s_inbox otherwise.
//   - list             — list paired peers and consent direction.
//   - leave <session-id> — revoke the allow for a peer (both directions).
//
// Addressing is by SESSION_ID, not slug: session.slug is NOT unique
// (Slug.create is a random adjective-noun pair and starts empty until a
// title is generated), so a slug cannot address a peer. The durable
// s2s_allow table is session_id based and is the consent authority. The
// subagent `message` tool keeps slug addressing — a parent owns its
// children's slug namespace and guarantees uniqueness there.
//   - relay [id?]      — emit a capsule as a copy-pasteable JSON blob
//                        (zero-infra fallback; v1 just returns the body
//                        in capsule shape so a future Task 8+
//                        cross-machine version can pick it up).
//
// Dependencies are intentionally narrow: S2SStore + Messaging + Session.
// The tool does NOT depend on SessionPrompt — the recipient wake is the
// poller's job, not the sender's (memory-#213 cycle rule: any tool in
// ToolRegistry must not require SessionPrompt).
//
// The cross-process path (`msg` to a non-local peer) goes through the
// module-local `enqueueExternal` helper, NOT through Messaging's
// Interface. Putting enqueueExternal on Messaging would have made
// Messaging.layer require S2SStore in its R, which broke a wave of
// existing tests that compose Messaging.layer without S2SStore
// (the `it.instance` harness from `test/lib/effect.ts` layers the
// test body over the merged layer, and a missing S2SStore in the
// merged layer's R surfaced as "Service not found" at the first
// `yield*`). The standalone helper keeps the dependency local.

import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Messaging, AbuseError, INBOX_CAP, S2S_HOURLY_OUTBOUND_CAP } from "../messaging"
import { Session } from "@/session/session"
import { S2SStore, TOKEN_TTL_MS } from "@/s2s/store"
import { S2SCapsule, encodeCapsule } from "@/s2s/capsule"
import { uuidv7 } from "@/s2s/uuidv7"
import { SessionID } from "@/session/schema"
import DESCRIPTION from "./s2s.txt"

const MAX_BODY_LENGTH = 16000

export const Parameters = Schema.Struct({
  command: Schema.Literals(["invite", "accept", "msg", "list", "leave", "relay"]).annotate({
    description: "Which s2s subcommand to run",
  }),
  // For `msg` and `leave` the user supplies the peer's session_id. For
  // `msg` the body is also required. For `invite`/`accept`/`list`/`relay` the
  // other args are unused. Each is optional at the schema level so a
  // partial call decodes; the tool's run function rejects shape
  // mismatches per-command with a precise error.
  target: Schema.optional(Schema.String).annotate({
    description: "For msg/leave: the peer's session_id (ses_...) to address",
  }),
  token: Schema.optional(Schema.String).annotate({
    description: "For accept: the one-shot token shared by the inviter",
  }),
  body: Schema.optional(Schema.String).annotate({
    description: "For msg: the message body",
  }),
})

type Peer = {
  peer_id: SessionID
  title: string
  established_at: number
  outbound: boolean
  inbound: boolean
}

type Metadata = {
  command: string
  target?: string
  peers?: Peer[]
}

export const S2STool = Tool.define<
  typeof Parameters,
  Metadata,
  Messaging.Service | Session.Service | S2SStore.Service
>(
  "s2s",
  Effect.gen(function* () {
    const messaging = yield* Messaging.Service
    const sessions = yield* Session.Service
    // S2SStore is a REAL dependency captured at init (like messaging/
    // sessions), NOT resolved via serviceOption at execute time. A tool's
    // execute runs in the processor's fiber, whose context does NOT carry
    // S2SStore (it lives in AppLayer above the tool-exec scope), so an
    // execute-time serviceOption(S2SStore) returns None in production even
    // though AppLayer provides it — making the tool unusable. ToolRegistry
    // provides S2SStore so this init-time yield resolves it once, captured
    // in the closure for every command.
    const store = yield* S2SStore.Service

    const run = Effect.fn("S2STool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      // Pre-flight: every command needs a known source session so we
      // can pull the sender's slug (used as fromSlug on rows/capsules
      // and in in-process enqueue calls). Reject early if the session
      // is gone — the tool's caller side has no useful action.
      const me = yield* sessions.get(ctx.sessionID)

      switch (params.command) {
        case "invite": {
          // Single-use v4 UUID. The token is the join credential; its
          // shape is intentionally opaque so a user can share it over
          // a chat channel without leaking session metadata.
          const token = crypto.randomUUID()
          yield* store.insertToken({
            token,
            inviterSessionID: ctx.sessionID,
            inviterSlug: me.slug,
            createdAt: Date.now(),
          })
          return {
            title: "Minted invite token",
            metadata: { command: "invite" },
            output: `Invite token: ${token}\nShare it with the peer session; they accept it with s2s(command:"accept", token:"...") within ${TOKEN_TTL_MS / 60_000} minutes.`,
          }
        }

        case "accept": {
          if (!params.token)
            return yield* Effect.fail(new Error('s2s(command:"accept") requires a token'))
          const claimed = yield* store.claimToken(params.token, ctx.sessionID)
          if (Option.isNone(claimed))
            return yield* Effect.fail(
              new Error(`s2s accept: token "${params.token}" is invalid, expired, or already used`),
            )
          const row = claimed.value
          // Two-direction allow: the joiner can now send to the inviter
          // AND the inviter can now send to the joiner. The DB rows
          // are directional (s2s_allow.session_id is the sender), so
          // both sides need a row.
          yield* store.insertAllow(ctx.sessionID, row.inviterSessionID)
          yield* store.insertAllow(row.inviterSessionID, ctx.sessionID)
          // Consent is durable in s2s_allow (session_id based) — that is
          // the authority `msg` checks via store.isAllowed. We do NOT seed
          // the in-process Messaging allow list here: that list is for the
          // subagent `message` tool's slug allow-list, kept separate so s2s
          // (session_id) and coordinator-messaging (slug) never mix keys.
          return {
            title: `Accepted invite from ${row.inviterSessionID}`,
            metadata: { command: "accept" },
            output: `Now allow-listed with peer ${row.inviterSessionID}. Use s2s(command:"msg", target:"${row.inviterSessionID}", body:"...") to send.`,
          }
        }

        case "msg": {
          if (!params.target)
            return yield* Effect.fail(new Error('s2s(command:"msg") requires target=<peer-session-id>'))
          if (!params.body)
            return yield* Effect.fail(new Error('s2s(command:"msg") requires body="..."'))
          if (params.body.length > MAX_BODY_LENGTH)
            return yield* Effect.fail(
              new Error(`s2s body exceeds maximum length of ${MAX_BODY_LENGTH} characters (got ${params.body.length})`),
            )

          // Addressing is by session_id. The target string IS the peer's
          // SessionID — no slug resolution (session.slug is not unique).
          const targetID = SessionID.make(params.target)
          if (targetID === ctx.sessionID)
            return yield* Effect.fail(new Error("s2s msg: cannot send to self"))

          // Consent: the durable s2s_allow table (session_id based) is the
          // single authority. `isAllowed(me, target)` is true iff we
          // accepted this peer (or they accepted us — accept writes both
          // directions). This works the same in-process and cross-process,
          // and survives a process restart (no in-proc allow re-seed needed).
          const allowed = yield* store.isAllowed(ctx.sessionID, targetID)
          if (!allowed)
            return yield* Effect.fail(
              new Error(`s2s msg: target "${params.target}" is not in your s2s allow list (invite/accept first)`),
            )

          // Same-process fast path: if the peer session is running in THIS
          // process, enqueue straight into its in-process inbox tagged
          // source="sibling-session" so the drain renders <external-context>.
          // Bypasses the s2s_inbox table and the hourly outbound cap (both
          // for cross-process only).
          const inProcess = yield* messaging.isLocal(targetID)
          if (inProcess) {
            yield* messaging
              .enqueue({
                target: targetID,
                from: ctx.sessionID,
                fromSlug: me.slug,
                fromName: me.title,
                body: params.body,
                source: "sibling-session",
              })
              .pipe(Effect.catchTag("Messaging.AbuseError", (e) => Effect.fail(new Error(e.detail))))
            return {
              title: `Sent to ${params.target}`,
              metadata: { command: "msg", target: params.target },
              output: "Queued in recipient's inbox (same process).",
            }
          }

          // Cross-process: persist to s2s_inbox; the recipient process's
          // wake poller claims and delivers it.
          const capsule: S2SCapsule = {
            version: 1,
            id: uuidv7(),
            sender_slug: me.slug,
            sender_name: me.title,
            sender_session_id: String(ctx.sessionID),
            timestamp: Date.now(),
            body: params.body,
          }
          yield* enqueueExternal({ store, target: targetID, fromSlug: me.slug, capsule }).pipe(
            Effect.catchTag("Messaging.AbuseError", (e) => Effect.fail(new Error(e.detail))),
          )
          return {
            title: `Sent to ${params.target}`,
            metadata: { command: "msg", target: params.target },
            output: `Persisted to s2s_inbox (id=${capsule.id}); recipient process will poll and wake.`,
          }
        }

        case "list": {
          const rows = yield* store.listAllows(ctx.sessionID)
          const peers = rows.reduce((result, row) => {
            const peerID = row.sessionID === ctx.sessionID ? row.allowedSessionID : row.sessionID
            const entry = result.get(peerID)
            const outbound = row.sessionID === ctx.sessionID
            const inbound = row.allowedSessionID === ctx.sessionID
            if (entry) {
              result.set(peerID, {
                ...entry,
                established_at: Math.min(entry.established_at, row.establishedAt),
                outbound: entry.outbound || outbound,
                inbound: entry.inbound || inbound,
              })
              return result
            }
            result.set(peerID, {
              peer_id: peerID,
              established_at: row.establishedAt,
              outbound,
              inbound,
            })
            return result
          }, new Map<SessionID, Omit<Peer, "title">>())
          const entries = yield* Effect.forEach(Array.from(peers.values()), (peer) =>
            sessions.get(peer.peer_id).pipe(
              Effect.map((session) => session.title || "(unknown)"),
              Effect.catchTag("NotFoundError", () => Effect.succeed("(unknown)")),
              Effect.map((title) => ({ ...peer, title })),
            ),
          )
          const sorted = entries.toSorted((a, b) => b.established_at - a.established_at)
          if (sorted.length === 0)
            return {
              title: "S2S peers",
              metadata: { command: "list", peers: [] },
              output: "No s2s peers.",
            }
          return {
            title: "S2S peers",
            metadata: { command: "list", peers: sorted },
            output: sorted
              .map((peer) => {
                const consent =
                  peer.outbound === peer.inbound
                    ? "bidirectional"
                    : `ANOMALOUS one-way (${peer.outbound ? "outbound only" : "inbound only"})`
                return `${peer.peer_id} · ${peer.title} · established ${new Date(peer.established_at).toISOString()} · consent: ${consent}`
              })
              .join("\n"),
          }
        }

        case "leave": {
          if (!params.target)
            return yield* Effect.fail(new Error('s2s(command:"leave") requires target=<peer-session-id>'))
          // Addressing by session_id: delete both allow directions in the
          // durable s2s_allow table. Idempotent — deleting a non-existent
          // allow is a no-op (the peer was never accepted or already left).
          const targetID = SessionID.make(params.target)
          yield* store.deleteAllow(ctx.sessionID, targetID)
          yield* store.deleteAllow(targetID, ctx.sessionID)
          return {
            title: `Left ${params.target}`,
            metadata: { command: "leave", target: params.target },
            output: `Removed s2s_allow rows in both directions for ${params.target}.`,
          }
        }

        case "relay": {
          // Zero-infra fallback: emit a capsule-shaped blob the user
          // can copy/paste to a peer on a different machine. v1 just
          // wraps the body (or an explanatory stub if no body is
          // given) in a v1 capsule. The future cross-machine wire
          // (Task 8+) will be the real consumer of this format.
          const capsule: S2SCapsule = {
            version: 1,
            id: uuidv7(),
            sender_slug: me.slug,
            sender_session_id: String(ctx.sessionID),
            timestamp: Date.now(),
            body: params.body ?? "(no body — relay stub)",
          }
          return {
            title: "Relay payload",
            metadata: { command: "relay" },
            output: JSON.stringify(capsule, null, 2),
          }
        }
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie) as unknown as Effect.Effect<Tool.ExecuteResult<Metadata>>,
    }
  }),
)

// Module-local cross-process enqueue. See the file-level comment for
// why this lives here instead of on Messaging.Interface. Same
// contract as the spec: bumpOutbound first (over-cap → AbuseError),
// per-sender id dedup window, recipient undelivered-row cap
// (INBOX_CAP → AbuseError "inbox full"). Does NOT touch TREE_MESSAGE_CAP.
const enqueueExternalDedup = new Map<SessionID, string[]>()
const enqueueExternalBumpOutbound = new Map<SessionID, { hour: number; count: number }>()

// Global cap on sender entries per Map to prevent unbounded growth
// over process lifetime. When a Map exceeds this limit, the oldest
// (first-inserted) sender entry is evicted before the new write.
const MAX_SENDER_ENTRIES = 500

const evictIfNeeded = <V>(map: Map<SessionID, V>, max: number) => {
  while (map.size > max) {
    const first = map.keys().next()
    if (first.done) break
    map.delete(first.value)
  }
}

const enqueueExternal = Effect.fn("S2STool.enqueueExternal")(function* (input: {
  store: S2SStore.Interface
  target: SessionID
  fromSlug: string
  capsule: S2SCapsule
}) {
  const sender = SessionID.make(input.capsule.sender_session_id)
  const store = input.store
  // SOFT per-process outbound throttle, NOT a durable abuse bound: this
  // Map lives in process memory, so it resets on restart and is not shared
  // across processes — a determined sender can exceed it by restarting or
  // running multiple processes. It exists only to catch a runaway loop in
  // the common single-process case. The DURABLE, cross-process abuse bound
  // is the recipient's INBOX_CAP below (countUndelivered is a DB COUNT, and
  // delivered rows are hard-deleted, so a recipient can never accumulate
  // more than INBOX_CAP undelivered rows regardless of sender restarts).
  // Wall-clock hour bucket; resets on the next hour boundary.
  const hour = Math.floor(Date.now() / 3_600_000)
  const existing = enqueueExternalBumpOutbound.get(sender)
  const current = existing && existing.hour === hour ? existing : { hour, count: 0 }
  if (current.count >= S2S_HOURLY_OUTBOUND_CAP)
    return yield* new AbuseError({
      detail: `s2s hourly outbound cap (${S2S_HOURLY_OUTBOUND_CAP}) reached for this session`,
    })
  enqueueExternalBumpOutbound.set(sender, { hour: current.hour, count: current.count + 1 })
  evictIfNeeded(enqueueExternalBumpOutbound, MAX_SENDER_ENTRIES)
  // Per-sender id dedup. Process-local LRU; a retried envelope
  // (same UUIDv7 id) is a silent no-op.
  const seen = enqueueExternalDedup.get(sender) ?? []
  if (seen.includes(input.capsule.id)) return
  // Recipient undelivered-row cap.
  const n = yield* store.countUndelivered(input.target)
  if (n >= INBOX_CAP)
    return yield* new AbuseError({
      detail: `recipient s2s inbox cap (${INBOX_CAP}) reached`,
    })
  yield* store.insertInbox({
    id: input.capsule.id,
    targetSessionID: input.target,
    fromSessionID: sender,
    fromSlug: input.fromSlug,
    capsule: encodeCapsule(input.capsule),
    timeCreated: Date.now(),
  })
  enqueueExternalDedup.set(sender, [...seen, input.capsule.id].slice(-100))
  evictIfNeeded(enqueueExternalDedup, MAX_SENDER_ENTRIES)
})
