import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { describePeer, resolvePeers } from "@/session/peers"
import DESCRIPTION from "./peers.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({})

export const PeersTool = Tool.define(
  "peers",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const [sessions, statuses, permissions] = yield* Effect.all([
            session.list(),
            status.list(),
            permission.list(),
          ])

          const peers = resolvePeers({
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
            // No loop state here: the Loop service depends on the prompt
            // layer, which depends on this registry, so a tool cannot import
            // it without a cycle. The queue brief runs INSIDE the loop and
            // passes the real loop info; a tool call sees status alone, which
            // is accurate because a loop-driven session is busy while it works.
            loops: [],
            callerID: ctx.sessionID,
            directory: ins.directory,
            now: Date.now(),
          })

          // An empty roster is a real, useful answer — say so rather than
          // returning a blank that reads like a failure.
          const output =
            peers.length === 0
              ? `No other agent sessions are active in ${ins.directory}.`
              : [
                  `${peers.length} other session${peers.length === 1 ? "" : "s"} active in ${ins.directory}:`,
                  "",
                  ...peers.map((peer) => `- ${describePeer(peer)}`),
                  "",
                  "If any of these overlaps what you are about to do, say so before you start.",
                ].join("\n")

          return {
            title: peers.length === 0 ? "No other agents here" : `${peers.length} other agent session(s)`,
            // Metadata only. No message text, prompt, tool call or tool output
            // from another session is reachable through this.
            metadata: { count: peers.length, peers },
            output,
          }
        }),
    }
  }),
)
