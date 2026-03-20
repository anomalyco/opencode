import { Option } from "effect"

import { Account as AccountSchema, type AccessToken, AccountID, OrgID, AccountEffect } from "./effect"

export { AccessToken, AccountID, OrgID } from "./effect"

export namespace Account {
  export const Account = AccountSchema
  export type Account = AccountSchema

  export function active(): Account | undefined {
    return Option.getOrUndefined(AccountEffect.runSync((service) => service.active()))
  }

  export async function config(accountID: AccountID, orgID: OrgID): Promise<Record<string, unknown> | undefined> {
    const config = await AccountEffect.runPromise((service) => service.config(accountID, orgID))
    return Option.getOrUndefined(config)
  }

  export async function token(accountID: AccountID): Promise<AccessToken | undefined> {
    const token = await AccountEffect.runPromise((service) => service.token(accountID))
    return Option.getOrUndefined(token)
  }
}
