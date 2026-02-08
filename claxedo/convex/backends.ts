/**
 * User Backends (Tunnel Mode)
 *
 * Convex functions for managing user-registered backend URLs.
 * Used when users expose their local OpenCode servers via tunnels.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get a user's registered backend.
 */
export const get = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("user_backends")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

/**
 * Get all backends for an organization.
 */
export const listByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("user_backends")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
  },
});

/**
 * Register or update a user's backend URL.
 */
export const register = mutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    backendUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("user_backends")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing registration
      await ctx.db.patch(existing._id, {
        backendUrl: args.backendUrl,
        lastSeen: now,
      });
      return existing._id;
    }

    // Create new registration
    return await ctx.db.insert("user_backends", {
      userId: args.userId,
      organizationId: args.organizationId,
      backendUrl: args.backendUrl,
      lastSeen: now,
      createdAt: now,
    });
  },
});

/**
 * Update the lastSeen timestamp for a backend (heartbeat).
 */
export const heartbeat = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("user_backends")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
      });
    }

    return !!existing;
  },
});

/**
 * Remove a user's backend registration.
 */
export const remove = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("user_backends")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }

    return false;
  },
});
