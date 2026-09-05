import { Effect, Schema, Scope } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { formatPeerMessage, resolveMessageTargets, resolveTarget } from "@/session/peers"
import type { TaskPromptOps } from "./task"
import DESCRIPTION from "./send-peer-message.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  target: Schema.String.annotate({
    description: "Session id, or an unambiguous prefix of the target session's title.",
  }),
  message: Schema.String.annotate({
    description: "The message text to deliver. Keep it short — point to files, commits, or specs rather than pasting large context.",
  }),
})

interface ResultMetadata {
  reason?: "ambiguous" | "not-found" | "busy" | "unreachable"
  matches?: string[]
  sessionID?: string
  accepted?: boolean
}

export const SendPeerMessageTool = Tool.define(
  "send_peer_message",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const scope = yield* Scope.Scope

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { target: string; message: string },
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<ResultMetadata>> =>
        Effect.gen(function* () {
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          // Missing promptOps is a wiring defect (session/tools.ts always
          // supplies it), not a normal failure mode a caller can act on — a
          // defect keeps this tool's error channel `never`, matching
          // Tool.Def's execute signature (same die-not-fail shape as other
          // invariant checks in this codebase).
          if (!ops) return yield* Effect.die(new Error("send_peer_message requires promptOps in ctx.extra"))

          const message = params.message.trim()
          if (message === "")
            return { title: "No message sent", metadata: {}, output: "Message text is empty — nothing sent." }

          const ins = yield* InstanceState.context
          const [sessions, statuses, permissions] = yield* Effect.all([
            session.list(),
            status.list(),
            permission.list(),
          ])

          const peers = resolveMessageTargets({
            sessions: sessions.map((item) => ({
              id: item.id,
              parentID: item.parentID,
              directory: item.directory,
              title: item.title,
              agent: item.agent,
              model: item.model ? { providerID: item.model.providerID, id: item.model.id } : undefined,
              updatedAt: item.time.updated,
            })),
            statuses,
            pendingPermission: new Set(permissions.map((item) => item.sessionID)),
            loops: [],
            callerID: ctx.sessionID,
            directory: ins.directory,
            now: Date.now(),
          })

          const resolved = resolveTarget(peers, params.target)
          if (!resolved.ok) {
            if (resolved.reason === "ambiguous") {
              return {
                title: "Ambiguous target",
                metadata: { reason: "ambiguous", matches: resolved.matches.map((p) => p.sessionID) },
                output:
                  `"${params.target}" matches more than one active peer session: ` +
                  resolved.matches.map((p) => `${p.sessionID} ("${p.title}")`).join(", ") +
                  ". Use the exact session id.",
              }
            }
            return {
              title: "Peer not found",
              metadata: { reason: "not-found" },
              output:
                `No session in this directory matches "${params.target}" (idle sessions are valid targets here, ` +
                "unlike the `peers` tool's awareness roster — but your own session and any subagent you spawned " +
                "are excluded either way).",
            }
          }
          const peer = resolved.peer

          // A literally in-flight turn (actively generating right now) must not
          // be joined or raced — the same foreign-turn hazard `loop.ts` guards
          // against. `awaiting-permission` / `stalled` / `cancelling` are not
          // mid-generation and are safe to prompt into.
          if (peer.status === "busy") {
            return {
              title: "Peer is busy",
              metadata: { reason: "busy", sessionID: peer.sessionID },
              output: `Peer session ${peer.sessionID} ("${peer.title}") is mid-turn right now. Not delivered — retry once it is idle or awaiting permission.`,
            }
          }

          const targetSessionID = SessionID.make(peer.sessionID)
          const [caller, target] = yield* Effect.all([
            session.get(ctx.sessionID).pipe(Effect.orElseSucceed(() => undefined)),
            session.get(targetSessionID).pipe(Effect.orElseSucceed(() => undefined)),
          ])
          if (!target) {
            return {
              title: "Peer disappeared",
              metadata: { reason: "unreachable", sessionID: peer.sessionID },
              output: `Peer session ${peer.sessionID} was found a moment ago but is gone now. Not delivered.`,
            }
          }

          const text = formatPeerMessage(
            { sessionID: ctx.sessionID, title: caller?.title ?? "(unknown session)" },
            message,
          )

          // Fire-and-forget, same pattern as the background-subagent result
          // injection in task.ts: the target's own turn (and any reply it
          // generates) is not this tool call's concern, and awaiting it would
          // block the sender on however long the peer takes to respond. This
          // means the honest claim available here is "accepted for delivery",
          // not "confirmed the peer has seen and acted on it".
          yield* ops
            .prompt({
              sessionID: targetSessionID,
              agent: target.agent ?? ctx.agent,
              parts: [{ type: "text", synthetic: true, text }],
            })
            .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))

          return {
            title: `Message sent to ${peer.title}`,
            metadata: { sessionID: peer.sessionID, accepted: true },
            output: `Accepted for delivery to peer session ${peer.sessionID} ("${peer.title}").`,
          }
        }),
    }
  }),
)
