export * as ClaudeWebSearch from "./websearch.js"

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { WebSearch } from "@opencode/plugin/effect"
import { Effect, Option, Schema } from "effect"
import os from "node:os"
import { ClaudeAgentError } from "../language-model/claude-agent-error.js"
import type { ClaudeIO } from "./io.js"
import { ClaudeQueryOptions } from "./query-options.js"
import { ClaudeSDK } from "./sdk.js"

const SYSTEM = [
  "You are a web search relay.",
  "Call the WebSearch tool exactly once, with the user's message as the query, verbatim.",
  "Do not answer from memory and do not call any other tool.",
].join(" ")

// What Claude Code reports after WebSearch: lists of links, with Claude's notes on them as plain strings
const Output = Schema.Struct({
  results: Schema.Array(
    Schema.Union([
      Schema.String,
      Schema.Struct({ content: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String })) }),
    ]),
  ),
})

export const search = Effect.fn("ClaudeWebSearch.search")(function* (input: {
  readonly executable: string
  readonly io: ClaudeIO.Interface
  readonly connection?: Readonly<Record<string, string>>
  readonly query: string
}) {
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const { query } = await ClaudeSDK.load()
      return query({
        prompt: input.query,
        options: {
          ...ClaudeQueryOptions.base(input),
          // The search reads no files, so it runs outside the project
          cwd: os.tmpdir(),
          // WebSearch returns page contents encrypted, so a model has to run it. The cheapest one is enough.
          model: "haiku",
          systemPrompt: SYSTEM,
          thinking: { type: "disabled" },
          tools: ["WebSearch"],
          allowedTools: ["WebSearch"],
          persistSession: false,
          maxTurns: 2,
        },
      })
    }),
    (session) =>
      Effect.tryPromise(async () => {
        const failure = ClaudeAgentError.make()
        for await (const message of session) {
          const error = failure(message)
          if (error) throw error
          const found = results(message)
          if (found) return found
        }
        throw new Error("Claude finished without searching the web")
      }),
    // Closing as soon as the results arrive skips Claude's own answer. The model that asked reads the results itself.
    (session) => Effect.sync(() => session.close()),
  ).pipe(
    // opencode sets no limit on a search provider, so a stuck claude would hold the tool call forever
    Effect.timeoutOrElse({
      duration: "1 minute",
      orElse: () => Effect.fail(new Error("Claude did not finish the web search within a minute")),
    }),
  )
})

export function results(message: SDKMessage): WebSearch.Result[] | undefined {
  if (message.type !== "user") return
  const output = Schema.decodeUnknownOption(Output)(message.tool_use_result)
  if (Option.isNone(output)) return
  const links = new Map<string, { readonly title: string; readonly url: string }>()
  const notes: string[] = []
  for (const item of output.value.results) {
    if (typeof item === "string") {
      notes.push(item.trim())
      continue
    }
    for (const link of item.content) {
      const key = page(link.url)
      const kept = links.get(key)
      // The shortest URL is the page itself. A copy listed first is often a translation, title included.
      if (!kept || link.url.length < kept.url.length) links.set(key, link)
    }
  }
  const found: WebSearch.Result[] = [...links.values()].map((link) => ({ url: link.url, title: link.title, time: {} }))
  const summary = notes.filter(Boolean).join("\n\n")
  const first = found[0]
  if (!summary || !first) return found
  // opencode lists results without a field for the whole search, so the summary rides on the first one, which says so
  found[0] = {
    ...first,
    title: `Summary of all results below, written by Claude (top source: ${first.title})`,
    content: summary,
  }
  return found
}

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" })

// Claude's search often lists one page many times: translated copies (/de/..., ?hl=fr), account variants
// (?authuser=2) and Markdown mirrors (page.md.txt). They share one key.
function page(url: string) {
  const parsed = URL.parse(url)
  if (!parsed) return url
  parsed.searchParams.delete("hl")
  parsed.searchParams.delete("authuser")
  parsed.pathname = parsed.pathname
    // A two-letter folder is a locale only when it names a language: /de/ does, /go/ and /js/ don't
    .replace(/^\/([a-z]{2})(-[a-z]{2,4})?(?=\/)/i, (folder, language) => (LANGUAGES.of(language) ? "" : folder))
    .replace(/\.md\.txt$/, "")
  return parsed.href
}
