import { Option, type Effect } from "effect"

import { Account as S, type AccountError, type AccessToken, AccountID, Info as Model, OrgID } from "./effect"
import * as M from "./effect"

export { AccessToken, AccountID, OrgID } from "./effect"

export namespace Account {
  export const Info = Model
  export type Info = Model

  export async function active(): Promise<Info | undefined> {
    return Option.getOrUndefined(await runPromise((service) => service.active()))
  }

  export async function config(accountID: AccountID, orgID: OrgID): Promise<Record<string, unknown> | undefined> {
    const config = await runPromise((service) => service.config(accountID, orgID))
    return Option.getOrUndefined(config)
  }

  export async function token(accountID: AccountID): Promise<AccessToken | undefined> {
    const token = await runPromise((service) => service.token(accountID))
    return Option.getOrUndefined(token)
  }
}

function runPromise<A>(f: (service: S.Interface) => Effect.Effect<A, AccountError>) {
  return M.runPromise(f)
}
