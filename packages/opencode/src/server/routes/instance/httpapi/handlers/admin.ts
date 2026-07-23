import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Identity } from "@/identity"
import { AdminApi } from "../groups/admin"
import { AdminBadRequestError, AdminNotFoundError } from "../errors"

export const adminHandlers = HttpApiBuilder.group(AdminApi, "admin", (handlers) =>
  Effect.gen(function* () {
    const identity = yield* Identity.Service

    const listUsers = Effect.fn("AdminHttpApi.listUsers")(function* () {
      yield* identity.requireAdmin().pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized({}))),
      )

      const users = yield* identity.listUsersWithBalances()
      return { users }
    })

    const credit = Effect.fn("AdminHttpApi.credit")(function* (ctx: {
      params: { id: string }
      payload: { amount: number; description: string }
    }) {
      yield* identity.requireAdmin().pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized({}))),
      )

      if (ctx.payload.amount < 0) {
        return yield* Effect.fail(new AdminBadRequestError({ message: "Amount must be non-negative" }))
      }

      const user = yield* identity.getByID(ctx.params.id)
      if (!user) {
        return yield* Effect.fail(new AdminNotFoundError({ message: `User ${ctx.params.id} not found` }))
      }

      const result = yield* identity.credit({
        userId: ctx.params.id,
        amount: ctx.payload.amount,
        description: ctx.payload.description,
      })

      return {
        userId: ctx.params.id,
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      }
    })

    const stats = Effect.fn("AdminHttpApi.stats")(function* () {
      yield* identity.requireAdmin().pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized({}))),
      )

      return yield* identity.stats()
    })

    const usageStats = Effect.fn("AdminHttpApi.usageStats")(function* (ctx: {
      query: { from?: string; to?: string }
    }) {
      yield* identity.requireAdmin().pipe(
        Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized({}))),
      )

      const from = ctx.query.from
      const to = ctx.query.to

      if (!from || !to) {
        return yield* Effect.fail(new AdminBadRequestError({ message: "Both 'from' and 'to' query parameters are required (YYYY-MM-DD)" }))
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return yield* Effect.fail(new AdminBadRequestError({ message: "Date format must be YYYY-MM-DD" }))
      }

      const entries = yield* identity.usageStats({ from, to })
      return { usage: entries }
    })

    return handlers
      .handle("listUsers", listUsers)
      .handle("credit", credit)
      .handle("stats", stats)
      .handle("usageStats", usageStats)
  }),
)
