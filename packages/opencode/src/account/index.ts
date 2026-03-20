import { Effect, Option } from "effect"

import { Account as S, type AccountError, type AccessToken, AccountID, Info as Model, OrgID } from "./effect"

export { AccessToken, AccountID, OrgID } from "./effect"

import { runtime } from "@/effect/runtime"

function runSync<A>(f: (service: S.Interface) => Effect.Effect<A, AccountError>) {
  return runtime.runSync(S.Service.use(f))
}

function runPromise<A>(f: (service: S.Interface) => Effect.Effect<A, AccountError>) {
  return runtime.runPromise(S.Service.use(f))
}

export namespace Account {
  export const Info = Model
  export type Info = Model

  export function active(): Info | undefined {
    return Option.getOrUndefined(runSync((service) => service.active()))
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
