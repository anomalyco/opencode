import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Identity } from "@/identity"
import { IdentityApi } from "../groups/identity"

export const identityHandlers = HttpApiBuilder.group(IdentityApi, "identity", (handlers) =>
  Effect.gen(function* () {
    const identity = yield* Identity.Service

    const getMe = Effect.fn("IdentityHttpApi.me")(function* () {
      const user = yield* identity.getCurrent()
      if (!user) {
        return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      }

      // Get balance from the user list.
      const users = yield* identity.listUsersWithBalances()
      const withBalance = users.find((u) => u.id === user.id)
      const balance = withBalance?.balance ?? 0

      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        tenantId: user.tenantId,
        isAdmin: user.isAdmin,
        balance,
      }
    })

    return handlers.handle("me", getMe)
  }),
)
