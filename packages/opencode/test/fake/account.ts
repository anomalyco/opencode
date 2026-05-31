import { Effect, Layer, Option } from "effect"
import { Account } from "../../src/account/account"

export const empty = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})

export * as AccountTest from "./account"
