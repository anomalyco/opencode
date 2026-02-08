import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";

/**
 * Get the current authenticated user's identity from Clerk JWT.
 * This uses Convex's built-in auth which validates the Clerk JWT.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<{ userId: string; email?: string } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return {
      userId: identity.subject, // Clerk user ID
      email: identity.email,
    };
  },
});

/**
 * Validate that the current request is authenticated.
 * Returns the user ID if authenticated, null otherwise.
 */
export const validateAuth = query({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const identity = await ctx.auth.getUserIdentity();
    return identity?.subject ?? null;
  },
});
