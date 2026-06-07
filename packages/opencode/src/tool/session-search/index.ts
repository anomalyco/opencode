import { Context, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { LexicalSearch } from "./lexical"
import type { LexicalMatch } from "./lexical"
import { SemanticSearch } from "./semantic"
import type { SemanticMatch } from "./semantic"

export interface SearchResult {
  sessionId: string
  sessionTitle: string
  messageId: string
  content: string
  score: number
  mode: "lexical" | "semantic"
  role: "user" | "assistant"
  createdAt: number
}

export interface Interface {
  search(input: {
    query: string
    scope: "local" | "global"
    semantic?: boolean
    exact?: boolean
    limit: number
  }): Effect.Effect<SearchResult[]>
}

export class SessionSearch extends Context.Service<SessionSearch, Interface>()(
  "@opencode/SessionSearch",
) {}

export const layer: Layer.Layer<
  SessionSearch,
  never,
  LexicalSearch | SemanticSearch | Database.Service | Session.Service
> = Layer.effect(
  SessionSearch,
  Effect.gen(function* () {
    const lexical = yield* LexicalSearch
    const semantic = yield* SemanticSearch
    const session = yield* Session.Service
    const db = yield* Database.Service

    function resolveLocalScope() {
      return Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* session.list({ directory: ctx.directory })
      })
    }

    const service: Interface = {
      search(input) {
        return Effect.gen(function* () {
          const sessionInfos = input.scope === "local"
            ? yield* resolveLocalScope()
            : yield* session.listGlobal({})
          if (sessionInfos.length === 0) return []

          const sessionTitleMap = buildSessionTitleMap(sessionInfos)
          const sessionIds = [...sessionTitleMap.keys()]

          const lexicalResults = yield* lexical.search({
            query: input.query,
            sessionIds,
            exact: input.exact,
            limit: input.limit * 3,
          })
          if (lexicalResults.length === 0) return []

          const wantSemantic = input.semantic === true && (yield* semantic.isAvailable())
          if (wantSemantic) {
            const semanticResults = yield* semantic.search({
              query: input.query,
              candidates: lexicalResults,
              limit: input.limit,
            }).pipe(Effect.catchCause(() => Effect.succeed([] as SemanticMatch[])))
            if (semanticResults.length > 0) {
              return formatSemanticResults(semanticResults, lexicalResults, sessionTitleMap)
            }
          }

          return formatLexicalResults(lexicalResults.slice(0, input.limit), sessionTitleMap)
        }).pipe(Effect.provideService(Database.Service, db))
      },
    }

    return service
  }),
)

// ==== Title map ====

function buildSessionTitleMap(
  sessionInfos: Array<{ id: string; title: string }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const info of sessionInfos) {
    map.set(info.id, info.title)
  }
  return map
}

// ==== Result formatting ====

function formatLexicalResults(
  matches: LexicalMatch[],
  sessionTitleMap: Map<string, string>,
): SearchResult[] {
  return matches.map(formatLexicalMatch(sessionTitleMap))
}

function formatLexicalMatch(sessionTitleMap: Map<string, string>) {
  return (match: LexicalMatch): SearchResult => ({
    sessionId: match.sessionId,
    sessionTitle: sessionTitleMap.get(match.sessionId) ?? "Unknown session",
    messageId: match.messageId,
    content: match.content,
    score: match.score,
    mode: "lexical",
    role: match.role,
    createdAt: match.createdAt,
  })
}

function formatSemanticResults(
  matches: SemanticMatch[],
  lexicalCandidates: LexicalMatch[],
  sessionTitleMap: Map<string, string>,
): SearchResult[] {
  const lexicalMap = buildLexicalLookup(lexicalCandidates)
  return matches.map(formatSemanticMatch(lexicalMap, sessionTitleMap))
}

function buildLexicalLookup(candidates: LexicalMatch[]): Map<string, LexicalMatch> {
  const map = new Map<string, LexicalMatch>()
  for (const c of candidates) {
    const key = `${c.sessionId}:${c.messageId}`
    if (!map.has(key)) {
      map.set(key, c)
    }
  }
  return map
}

function formatSemanticMatch(
  lexicalMap: Map<string, LexicalMatch>,
  sessionTitleMap: Map<string, string>,
) {
  return (match: SemanticMatch): SearchResult => {
    const key = `${match.sessionId}:${match.messageId}`
    const lexical = lexicalMap.get(key)
    return {
      sessionId: match.sessionId,
      sessionTitle: sessionTitleMap.get(match.sessionId) ?? "Unknown session",
      messageId: match.messageId,
      content: match.content,
      score: match.score,
      mode: "semantic",
      role: lexical?.role ?? "assistant",
      createdAt: lexical?.createdAt ?? 0,
    }
  }
}
