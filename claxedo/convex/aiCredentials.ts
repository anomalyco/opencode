import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

export const getByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiCredentials")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
  },
});

export const getByOrgAndProvider = query({
  args: {
    organizationId: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiCredentials")
      .withIndex("by_org_provider", (q) => 
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first();
  },
});

export const listProviders = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const creds = await ctx.db
      .query("aiCredentials")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();

    return creds.map((c) => ({
      provider: c.provider,
      hasKey: !!c.encryptedKey,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  },
});

// ─────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────

export const set = mutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
    encryptedKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if exists
    const existing = await ctx.db
      .query("aiCredentials")
      .withIndex("by_org_provider", (q) => 
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedKey: args.encryptedKey,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("aiCredentials", {
        organizationId: args.organizationId,
        provider: args.provider,
        encryptedKey: args.encryptedKey,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const remove = mutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiCredentials")
      .withIndex("by_org_provider", (q) => 
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const removeAll = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const creds = await ctx.db
      .query("aiCredentials")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();

    for (const c of creds) {
      await ctx.db.delete(c._id);
    }

    return creds.length;
  },
});
