import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getById = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByDirectory = query({
  args: { directory: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .withIndex("by_directory", (q) => q.eq("directory", args.directory))
      .first();
  },
});

export const getByProjectAndName = query({
  args: { projectId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .withIndex("by_project_name", (q) =>
        q.eq("projectId", args.projectId).eq("name", args.name),
      )
      .first();
  },
});

export const listByProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.string(),
    name: v.string(),
    directory: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_project_name", (q) =>
        q.eq("projectId", args.projectId).eq("name", args.name),
      )
      .first();
    if (existing) {
      if (existing.directory !== args.directory) {
        await ctx.db.patch(existing._id, {
          directory: args.directory,
          updatedAt: Date.now(),
        });
      }
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("workspaces", {
      projectId: args.projectId,
      name: args.name,
      directory: args.directory,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSandbox = mutation({
  args: {
    id: v.id("workspaces"),
    sandboxId: v.optional(v.string()),
    sandboxUrl: v.optional(v.string()),
    sandboxStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Workspace not found");

    await ctx.db.patch(args.id, {
      ...(args.sandboxId !== undefined ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxUrl !== undefined ? { sandboxUrl: args.sandboxUrl } : {}),
      ...(args.sandboxStatus !== undefined
        ? { sandboxStatus: args.sandboxStatus }
        : {}),
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

export const deleteWorkspace = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return;

    const sessions = await ctx.db
      .query("chat_sessions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.id))
      .collect();

    await Promise.all(sessions.map((s) => ctx.db.delete(s._id)));
    await ctx.db.delete(args.id);
  },
});
