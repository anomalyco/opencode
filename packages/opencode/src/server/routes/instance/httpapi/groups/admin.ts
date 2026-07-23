import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { AdminNotFoundError, AdminBadRequestError } from "../errors"

const UserWithBalanceSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  tenantId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  lastLoginAt: Schema.Number,
  isAdmin: Schema.Boolean,
  balance: Schema.Number,
  lifetimeUsed: Schema.Number,
}).annotate({ identifier: "UserWithBalance" })

const AdminUsersResponse = Schema.Struct({
  users: Schema.Array(UserWithBalanceSchema),
}).annotate({ identifier: "AdminUsersResponse" })

const CreditPayload = Schema.Struct({
  amount: Schema.Number,
  description: Schema.String,
}).annotate({ identifier: "AdminCreditPayload" })

const AdminCreditResponse = Schema.Struct({
  userId: Schema.String,
  newBalance: Schema.Number,
  transactionId: Schema.Number,
}).annotate({ identifier: "AdminCreditResponse" })

const AdminStatsResponse = Schema.Struct({
  totalUsers: Schema.Number,
  totalBalance: Schema.Number,
  totalUsedThisMonth: Schema.Number,
}).annotate({ identifier: "AdminStatsResponse" })

const AdminUsageStatsEntrySchema = Schema.Struct({
  date: Schema.String,
  userId: Schema.String,
  email: Schema.String,
  tokensUsed: Schema.Number,
  costUsd: Schema.Number,
  requestCount: Schema.Number,
}).annotate({ identifier: "AdminUsageStatsEntry" })

const AdminUsageStatsResponse = Schema.Struct({
  usage: Schema.Array(AdminUsageStatsEntrySchema),
}).annotate({ identifier: "AdminUsageStatsResponse" })

export const AdminPaths = {
  users: "/admin/users",
  credit: "/admin/users/:id/credit",
  stats: "/admin/stats",
  usageStats: "/admin/stats/usage",
} as const

export const AdminApi = HttpApi.make("admin").add(
  HttpApiGroup.make("admin")
    .add(
      HttpApiEndpoint.get("listUsers", AdminPaths.users, {
        success: described(AdminUsersResponse, "List of all users with balances"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "admin.users.list",
          summary: "List users",
          description: "List all users with their token balances. Admin access required.",
        }),
      ),
      HttpApiEndpoint.post("credit", AdminPaths.credit, {
        params: { id: Schema.String },
        payload: CreditPayload,
        success: described(AdminCreditResponse, "Credit applied"),
        error: [AdminNotFoundError, AdminBadRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "admin.users.credit",
          summary: "Credit user",
          description: "Add tokens to a user's balance. Admin access required.",
        }),
      ),
      HttpApiEndpoint.get("stats", AdminPaths.stats, {
        success: described(AdminStatsResponse, "Aggregated admin statistics"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "admin.stats",
          summary: "Admin stats",
          description: "Get aggregated token usage statistics. Admin access required.",
        }),
      ),
      HttpApiEndpoint.get("usageStats", AdminPaths.usageStats, {
        success: described(AdminUsageStatsResponse, "Daily usage breakdown"),
        error: [AdminBadRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "admin.stats.usage",
          summary: "Admin usage stats",
          description: "Get daily per-user usage breakdown for a date range. Admin access required.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "admin",
        description: "Admin-only user and token management routes.",
      }),
    )
    .middleware(Authorization),
)
