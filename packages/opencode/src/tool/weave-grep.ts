import z from "zod"
import { Tool } from "./tool"
import { WeaveDB } from "@/session/weave"

export const WeaveGrepTool = Tool.define("weave_grep", {
  description:
    "Search Weave memory records (summaries, episodes, thread dispatches) for relevant context in the active session.",
  parameters: z.object({
    query: z.string().describe("Case-insensitive query text to match in Weave records."),
    limit: z.number().int().positive().max(200).optional().describe("Maximum number of results to return."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "weave_grep",
      patterns: ["*"],
      always: ["*"],
      metadata: { query: params.query, limit: params.limit },
    })
    const store = await WeaveDB.read(ctx.sessionID)
    const query = params.query.toLowerCase()
    const limit = params.limit ?? 20

    const hits: string[] = []
    for (const node of store.summaryNodes) {
      if (node.text.toLowerCase().includes(query)) {
        hits.push(`[summary:${node.id}] ${node.text}`)
      }
    }
    for (const episode of store.episodes) {
      if (episode.summary.toLowerCase().includes(query)) {
        hits.push(`[episode:${episode.id}] ${episode.summary}`)
      }
    }
    for (const dispatch of store.dispatches) {
      if (dispatch.action.toLowerCase().includes(query)) {
        hits.push(`[thread:${dispatch.threadID}] ${dispatch.action}`)
      }
    }

    const output = hits.slice(0, limit)
    return {
      title: "Weave memory search",
      metadata: { query: params.query, matches: hits.length, truncated: hits.length > output.length },
      output: output.length ? output.join("\n") : "No Weave memory matches found.",
    }
  },
})
