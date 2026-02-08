import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const sync = mutation({
  args: {
    workspaceId: v.string(),
    sessionId: v.string(),
    title: v.string(),
    slug: v.string(), // used for URL construction if needed
    updatedAt: v.number(), // timestamp from the session data
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chat_sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        slug: args.slug,
        updatedAt: args.updatedAt,
        // We assume workspaceId doesn't change for a session ID
      });
    } else {
      await ctx.db.insert("chat_sessions", {
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        title: args.title,
        slug: args.slug,
        createdAt: Date.now(),
        updatedAt: args.updatedAt,
      });
    }
  },
});

export const list = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chat_sessions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc") // Most recent first
      .collect();
  },
});

export const remove = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chat_sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!existing) return;
    await ctx.db.delete(existing._id);
  },
});
