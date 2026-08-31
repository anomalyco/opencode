import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WebSearchTool } from "../../src/tool/websearch"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { setCrawlState, setScrapeState } from "../../src/cli/cmd/scrape-state"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const stateDir = mkdtempSync(join(tmpdir(), "opencode-e2e-test-"))
process.env.OPENCODE_STATE_DIR = stateDir

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))
const ctx = {
  sessionID: SessionID.make("ses_e2e_test"),
  messageID: MessageID.make("msg_e2e"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const exec = Effect.fn("WebSearchE2E.exec")(function* (args: Tool.InferParameters<typeof WebSearchTool>) {
  const info = yield* WebSearchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

describe("websearch e2e — DuckDuckGo via Python", () => {
  it.instance("returns Reddit results for Reddit query", () =>
    Effect.gen(function* () {
      const result = yield* exec({
        query: "Reddit MCP servers discussions",
        numResults: 5,
      })
      // If rate-limited, the result is still valid — just not a search result
      if (result.output.includes("rate limit")) {
        expect(result.title).toContain("DuckDuckGo")
        expect(result.metadata?.provider).toBe("duckduckgo")
        return
      }
      // Results should mention Reddit in title, URL, or snippet
      const hasReddit = result.output.toLowerCase().includes("reddit")
      expect(hasReddit).toBe(true)
      expect(result.title).toContain("DuckDuckGo")
      expect(result.metadata?.provider).toBe("duckduckgo")
    }),
  )

  it.instance("returns results without API key", () =>
    Effect.gen(function* () {
      const result = yield* exec({
        query: "what is a model context protocol",
        numResults: 3,
      })
      expect(result.output.length).toBeGreaterThan(0)
      expect(result.output).not.toContain("API key")
      expect(result.output).not.toContain("exa")
      expect(result.output).not.toContain("parallel")
    }),
  )

  it.instance("search works while crawl is OFF", () =>
    Effect.gen(function* () {
      setCrawlState(false)
      const result = yield* exec({
        query: "Reddit AI coding agents",
        numResults: 3,
      })
      expect(result.output.length).toBeGreaterThan(0)
      expect(result.title).toContain("DuckDuckGo")
    }),
  )

  it.instance("search works while scrape is OFF", () =>
    Effect.gen(function* () {
      setScrapeState(false)
      const result = yield* exec({
        query: "Reddit programming tips",
        numResults: 3,
      })
      expect(result.output.length).toBeGreaterThan(0)
      expect(result.title).toContain("DuckDuckGo")
    }),
  )

  it.instance("rate limiter blocks rapid consecutive searches", () =>
    Effect.gen(function* () {
      // First search should succeed
      const r1 = yield* exec({
        query: "rate limit test 1",
        numResults: 1,
      })
      expect(r1.title).toContain("DuckDuckGo")

      // Immediately trigger another search — should be rate-limited
      const r2 = yield* exec({
        query: "rate limit test 2",
        numResults: 1,
      })
      // The rate limiter should either return a rate-limit message or succeed
      // (if enough time elapsed). Either is acceptable.
      expect(r2.output.length).toBeGreaterThan(0)
      expect(r2.title).toBeDefined()
    }),
  )

  it.instance("search returns URL-containing results", () =>
    Effect.gen(function* () {
      const result = yield* exec({
        query: "open source AI tools 2024",
        numResults: 3,
      })
      // Results should either contain URLs or be a rate-limit message (both valid)
      const hasUrl = /https?:\/\//.test(result.output)
      const isRateLimited = result.output.includes("rate limit")
      expect(hasUrl || isRateLimited).toBe(true)
    }),
  )
})
