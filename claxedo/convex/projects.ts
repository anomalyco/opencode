import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

export const getById = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByExternalId = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_external", (q) => q.eq("externalId", args.externalId))
      .first();
  },
});

export const listByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .collect();
  },
});

export const listByOrgWithWorkspaces = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .collect();

    // Server-side join: fast local loop
    const results = await Promise.all(
      projects.map(async (p) => {
        const workspaces = await ctx.db
          .query("workspaces")
          .withIndex("by_project", (q) => q.eq("projectId", p._id))
          .collect();
        return {
          ...p,
          workspaces,
        };
      })
    );

    return results;
  },
});

// ─────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────

export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    repoUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
    externalId: v.optional(v.string()), // OpenCode ULID for compatibility
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      name: args.name,
      repoUrl: args.repoUrl,
      branch: args.branch,
      externalId: args.externalId,
      createdAt: now,
      updatedAt: now,
    });

    return projectId;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
    sandboxSnapshotId: v.optional(v.string()),
    icon: v.optional(v.object({
      url: v.optional(v.string()),
      override: v.optional(v.string()),
      color: v.optional(v.string()),
    })),
    commands: v.optional(v.object({
      start: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Project not found");

    // Build patch object, merging icon and commands with existing values
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.repoUrl !== undefined) patch.repoUrl = updates.repoUrl;
    if (updates.branch !== undefined) patch.branch = updates.branch;
    if (updates.sandboxSnapshotId !== undefined) patch.sandboxSnapshotId = updates.sandboxSnapshotId;

    // Merge icon fields with existing
    if (updates.icon !== undefined) {
      patch.icon = {
        ...existing.icon,
        ...updates.icon,
      };
    }

    // Merge commands fields with existing
    if (updates.commands !== undefined) {
      patch.commands = {
        ...existing.commands,
        ...updates.commands,
      };
    }

    await ctx.db.patch(id, patch);

    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
