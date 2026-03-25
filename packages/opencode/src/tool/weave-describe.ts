import z from "zod"
import { Tool } from "./tool"
import { WeaveDB } from "@/session/weave"

export const WeaveDescribeTool = Tool.define("weave_describe", {
  description: "Describe Weave memory state for the current session (snapshots, summaries, episodes, threads).",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "weave_describe",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const store = await WeaveDB.read(ctx.sessionID)
    const output = [
      `session: ${store.sessionID}`,
      `store_version: ${store.version}`,
      `snapshots: ${store.snapshots.length}`,
      `summary_nodes: ${store.summaryNodes.length}`,
      `episodes: ${store.episodes.length}`,
      `dispatches: ${store.dispatches.length}`,
      `message_links: ${store.messageLinks.length}`,
      `updated_at: ${new Date(store.updatedAt).toISOString()}`,
    ].join("\n")

    return {
      title: "Weave memory state",
      metadata: {
        snapshots: store.snapshots.length,
        summaries: store.summaryNodes.length,
        episodes: store.episodes.length,
        dispatches: store.dispatches.length,
      },
      output,
    }
  },
})
