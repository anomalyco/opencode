import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { CrawlTool } from "../../src/tool/crawl"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { CRAWL_DISABLED_MESSAGE, setCrawlState } from "../../src/cli/cmd/scrape-state"

const stateDir = mkdtempSync(join(tmpdir(), "opencode-crawl-test-"))
process.env.OPENCODE_STATE_DIR = stateDir

afterAll(() => rmSync(stateDir, { recursive: true, force: true }))

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))
const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const exec = Effect.fn("CrawlToolTest.exec")(function* (args: Tool.InferParameters<typeof CrawlTool>) {
  const info = yield* CrawlTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

describe("tool.crawl", () => {
  it.instance("does not start the standalone crawler while disabled", () =>
    Effect.gen(function* () {
      setCrawlState(false)
      const result = yield* exec({ url: "https://example.com" })
      expect(result.output).toBe(CRAWL_DISABLED_MESSAGE)
    }),
  )

  test("crawl.ts source forwards scroll to crawler CLI", () => {
    const crawlSource = readFileSync(
      join(import.meta.dirname, "../../src/tool/crawl.ts"),
      "utf-8",
    )
    expect(crawlSource).toContain("scroll: Schema.optional(Schema.Boolean)")
    expect(crawlSource).toContain('if (scroll) args.push("--scroll")')
    expect(crawlSource).toContain("crawlWithStandaloneCrawler(params.url, params.mode ?? \"http\", params.timeout ?? 30, params.scroll)")
  })
})
