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

export const AdminPaths = {
  users: "/admin/users",
  credit: "/admin/users/:id/credit",
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
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "admin",
        description: "Admin-only user and token management routes.",
      }),
    )
    .middleware(Authorization),
)
