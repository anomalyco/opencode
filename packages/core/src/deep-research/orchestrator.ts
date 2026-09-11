export * as Orchestrator from "./orchestrator"

import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { planQueries } from "./planner"
import { search } from "./search"
import { fetchPages } from "./fetch"
import { extractEvidenceBatch, resolveCrossReferences } from "./extract"
import { rankSources } from "./rank"
import type { Evidence, FetchedPage, ResearchConfig, ResearchRound, Source, SearchResultItem } from "./types"
import { normalizeConfig } from "./types"

export interface ResearchPlan {
  rounds: ResearchRound[]
  sources: Source[]
  evidence: Evidence[]
  notes: string[]
  queries: string[]
}

function mergeRounds(rounds: ResearchRound[]): string[] {
  return [...new Set(rounds.flatMap((r) => r.queries))]
}

interface ResearchState {
  rounds: ResearchRound[]
  seenURLs: Set<string>
  queries: string[]
  sources: Source[]
  evidence: Evidence[]
  fetchedPages: FetchedPage[]
  notes: string[]
}

/**
 * Runs a deep research pass over the input goal.
 *
 * Deterministic decision-making across every stage:
 *   1. Query Planner produces a parallel set of search queries (with CVE/GHSA/
 *      CWE-specific expansion when present).
 *   2. Parallel Search Layer fires all queries against every enabled provider.
 *   3. Results are URL-deduplicated and ranked.
 *   4. Parallel Fetch Layer fetchs the top sources concurrently with a concurrency
 *      cap, per-domain throttle, page cache, timeouts and retries.
 *   5. Content Extraction: content-type detection → parser → cleaning → chunks.
 *   6. Evidence Extraction pulls claims, code, tables, references from each page.
 *   7. Cross-source verification surfaces references from fetched pages that are
 *      not yet visited; a follow-up round fetches the strongest of them.
 *   8. Final sources are re-ranked and bounded.
 *
 * The orchestrator NEVER blocks the overall session prompt on sequential
 * fetch-then-analyze loops; every stage within a round is massively parallel.
 */
export function research(
  goal: string,
  configInput: Partial<ResearchConfig>,
  sessionID: string,
): (http: HttpClient.HttpClient) => Effect.Effect<ResearchPlan, never, never> {
  const config = normalizeConfig(configInput)
  return (http) =>
    Effect.gen(function* () {
      const state: ResearchState = {
        rounds: [],
        seenURLs: new Set(),
        queries: [],
        sources: [],
        evidence: [],
        fetchedPages: [],
        notes: [],
      }

      for (let depth = 0; depth <= config.maxDepth; depth++) {
        const queries = planQueries(goal, config.maxQueries, depth).filter((q) => !state.queries.includes(q))
        if (queries.length === 0) break
        state.queries.push(...queries)
        state.rounds.push({ depth, queries })

        const results: SearchResultItem[] = yield* search(
          http,
          config,
          queries,
          sessionID,
          config.maxResultsPerQuery,
        )
        const newResults = results.filter((r) => !state.seenURLs.has(r.url))
        for (const r of newResults) state.seenURLs.add(r.url)

        if (depth > 0 && newResults.length > 0 && config.minRelevanceScore > 0) {
          // Deeper rounds keep only pre-ranked candidates so follow-up fetches
          // stay bounded and focused.
          state.sources = [...state.sources, ...rankSources(newResults, [], goal, config.maxTotalFetches)]
        }

        if (newResults.length > 0) {
          const pages = yield* fetchPages(http, newResults.map((r) => r.url), config)
          const fresh = pages.filter((p) => !state.fetchedPages.some((x) => x.canonicalURL === p.canonicalURL))
          state.fetchedPages.push(...fresh)
          if (fresh.length > 0) {
            const extractions = extractEvidenceBatch(fresh, state.evidence.length)
            for (const e of extractions) state.evidence.push(e)
            if (depth < config.maxDepth) {
              const unvisited = resolveCrossReferences(extractions).filter((u) => !state.seenURLs.has(u))
              const capped = unvisited.slice(0, 8)
              const extraPages = yield* fetchPages(http, capped, config)
              const extraFresh = extraPages.filter((p) => !state.fetchedPages.some((x) => x.canonicalURL === p.canonicalURL))
              for (const p of extraFresh) {
                state.seenURLs.add(p.url)
                state.fetchedPages.push(p)
              }
              const extraExtractions = extractEvidenceBatch(extraFresh, state.evidence.length)
              for (const e of extraExtractions) state.evidence.push(e)
            }
          }
        }
      }

      const sources = rankSources(
        [...state.fetchedPages.map((p) => ({ title: p.title, url: p.url, snippet: p.markdown.slice(0, 200) }))].concat(
          state.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })),
        ),
        state.fetchedPages,
        goal,
        config.maxTotalFetches,
      )

      if (state.evidence.length === 0) state.notes.push("No extractable evidence found across all sources.")

      return {
        rounds: state.rounds,
        sources,
        evidence: state.evidence.slice(0, 60),
        notes: state.notes.slice(0, 10),
        queries: mergeRounds(state.rounds),
      }
    })
}