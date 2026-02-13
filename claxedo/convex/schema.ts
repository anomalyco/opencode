import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─────────────────────────────────────────────
  // CLAXEDO DOMAIN
  // ─────────────────────────────────────────────
  projects: defineTable({
    organizationId: v.string(),
    name: v.string(),
    repoUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
    externalId: v.optional(v.string()), // stable external identifier (e.g. "proj-...")
    sandboxSnapshotId: v.optional(v.string()),
    // Project customization (edit project dialog)
    icon: v.optional(v.object({
      url: v.optional(v.string()),      // auto-discovered favicon
      override: v.optional(v.string()), // user-uploaded base64 image
      color: v.optional(v.string()),    // avatar color when no icon
    })),
    commands: v.optional(v.object({
      start: v.optional(v.string()),    // startup script for new worktrees
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_name", ["organizationId", "name"])
    // Lookup by external ID for cloud project creation flows.
    .index("by_external", ["externalId"]),

  workspaces: defineTable({
    projectId: v.string(),
    name: v.string(),
    directory: v.string(),
    sandboxId: v.optional(v.string()),
    sandboxUrl: v.optional(v.string()),
    sandboxStatus: v.optional(v.string()), // "running", "stopped", "deleted"
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_name", ["projectId", "name"])
    .index("by_directory", ["directory"]),

  // ─────────────────────────────────────────────
  // AI CREDENTIALS (encrypted, per organization)
  // ─────────────────────────────────────────────
  aiCredentials: defineTable({
    organizationId: v.string(),
    provider: v.string(), // "openai", "anthropic", "google"
    encryptedKey: v.string(), // AES-256-GCM encrypted
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["organizationId"])

    .index("by_org_provider", ["organizationId", "provider"]),

  // ─────────────────────────────────────────────
  // CHAT SESSIONS (Synced Metadata)
  // ─────────────────────────────────────────────
  chat_sessions: defineTable({
    workspaceId: v.string(),
    sessionId: v.string(),
    slug: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_session_id", ["sessionId"]),

  // ─────────────────────────────────────────────
  // USER BACKENDS (for tunnel mode)
  // Allows users to register their local backends via tunnel URLs
  // ─────────────────────────────────────────────
  user_backends: defineTable({
    userId: v.string(),
    organizationId: v.string(),
    backendUrl: v.string(),
    lastSeen: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"]),

});
