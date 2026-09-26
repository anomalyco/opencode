import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./recall.txt"
import { Recall } from "@opencode-ai/core/recall/indexer"

// Sprint 6 fix: anti-loop from sprint 5 was too aggressive
// (MAX_CALLS_PER_SESSION=2 blocked LLM follow-up recall queries even when
// it had hit budget). The original M3 injects context on the first call, so
// the LLM does not normally need to call recall — but when it does (e.g. to
// drill down or follow up), we should not block the second call. Bumped
// to 5 to match the default recall limit.
const callCounts = new Map<string, number>()
const MAX_CALLS_PER_SESSION = 5

/**
 * Session id used by direct (non-LLM) invocations of this tool, such as the
 * experimental `POST /experimental/tool/invoke` endpoint.
 *
 * Those calls are exempt from the anti-loop cap — there is no model turn to
 * loop — and, just as importantly, they must not enter `callCounts` at all:
 * the endpoint is mounted unconditionally, so a per-call id would let any
 * caller grow that map without bound. One shared constant key, never counted,
 * has neither problem. Pass a real `sessionId` to opt back into the cap.
 */
export const UNCAPPED_SESSION_ID = "ses_experimental_invoke"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Natural language query against past conversation transcripts (all local sessions)",
  }),
  limit: Schema.optional(
    Schema.Int.annotate({ description: "Maximum number of hits to return (default 5)" }),
  ),
})

export const RecallTool = Tool.define(
  "recall",
  Effect.gen(function* () {
    const recall = yield* Recall.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Sprint 5: anti-loop. Per-session cap. M3 may auto-inject context
          // before the LLM's first turn, so the LLM doesn't need to call recall
          // itself; if it does anyway, refuse after MAX_CALLS_PER_SESSION.
          const sid = ctx.sessionID
          const capped = sid !== UNCAPPED_SESSION_ID
          const calls = capped ? (callCounts.get(sid) ?? 0) + 1 : 0
          if (capped && calls > MAX_CALLS_PER_SESSION) {
            return {
              title: `recall ${args.query} (limit reached)`,
              metadata: { count: 0, sessions: [] as string[], limitReached: true, calls },
              output:
                `Recall already invoked ${MAX_CALLS_PER_SESSION} times in this session ` +
                `(auto-inject via OPENCODE_RECALL_AUTO_INVOKE may have populated context already). ` +
                `Use the existing system context to answer; do not re-query.`,
            }
          }
          if (capped) callCounts.set(sid, calls)
          const hits = yield* recall.search({ query: args.query, limit: args.limit ?? 5 })
          const sessions = [...new Set(hits.map((hit: { sessionID: string }) => hit.sessionID))]
          if (hits.length === 0) {
            return {
              title: `recall ${args.query}`,
              metadata: { count: 0, sessions, limitReached: false, calls: 0 },
              output: `No transcript matches for "${args.query}".`,
            }
          }
          const output = hits
            .map((hit: { sessionID: string; text: string; score: number }, index: number) => {
              const snippet = hit.text.length > 600 ? `${hit.text.slice(0, 600)}…` : hit.text
              return `[${index + 1}] session=${hit.sessionID} score=${hit.score.toFixed(3)}\n${snippet}`
            })
            .join("\n\n---\n\n")
          return {
            title: `recall ${args.query}`,
            metadata: { count: hits.length, sessions, limitReached: false, calls },
            output,
          }
        }),
    }
  }),
)
