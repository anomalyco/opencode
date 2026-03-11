import { Schema } from "effect"

import { withStatics } from "@/util/schema"

export const AccountID = Schema.String.pipe(
  Schema.brand("AccountId"),
  withStatics((s) => ({ make: (id: string) => s.makeUnsafe(id) })),
)
export type AccountID = Schema.Schema.Type<typeof AccountID>

export const OrgID = Schema.String.pipe(
  Schema.brand("OrgId"),
  withStatics((s) => ({ make: (id: string) => s.makeUnsafe(id) })),
)
export type OrgID = Schema.Schema.Type<typeof OrgID>

export const AccessToken = Schema.String.pipe(
  Schema.brand("AccessToken"),
  withStatics((s) => ({ make: (token: string) => s.makeUnsafe(token) })),
)
export type AccessToken = Schema.Schema.Type<typeof AccessToken>

export const RefreshToken = Schema.String.pipe(
  Schema.brand("RefreshToken"),
  withStatics((s) => ({ make: (token: string) => s.makeUnsafe(token) })),
)
export type RefreshToken = Schema.Schema.Type<typeof RefreshToken>

export const DeviceCode = Schema.String.pipe(
  Schema.brand("DeviceCode"),
  withStatics((s) => ({ make: (code: string) => s.makeUnsafe(code) })),
)
export type DeviceCode = Schema.Schema.Type<typeof DeviceCode>

export const UserCode = Schema.String.pipe(
  Schema.brand("UserCode"),
  withStatics((s) => ({ make: (code: string) => s.makeUnsafe(code) })),
)
export type UserCode = Schema.Schema.Type<typeof UserCode>

export class Account extends Schema.Class<Account>("Account")({
  id: AccountID,
  email: Schema.String,
  url: Schema.String,
  active_org_id: Schema.NullOr(OrgID),
}) {}

export class Org extends Schema.Class<Org>("Org")({
  id: OrgID,
  name: Schema.String,
}) {}

export class AccountRepoError extends Schema.TaggedErrorClass<AccountRepoError>()("AccountRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class AccountServiceError extends Schema.TaggedErrorClass<AccountServiceError>()("AccountServiceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export type AccountError = AccountRepoError | AccountServiceError

export class Login extends Schema.Class<Login>("Login")({
  code: DeviceCode,
  user: UserCode,
  url: Schema.String,
  server: Schema.String,
  expiry: Schema.Duration,
  interval: Schema.Duration,
}) {}

export class PollSuccess extends Schema.TaggedClass<PollSuccess>()("PollSuccess", {
  email: Schema.String,
}) {}

export class PollPending extends Schema.TaggedClass<PollPending>()("PollPending", {}) {}

export class PollSlow extends Schema.TaggedClass<PollSlow>()("PollSlow", {}) {}

export class PollExpired extends Schema.TaggedClass<PollExpired>()("PollExpired", {}) {}

export class PollDenied extends Schema.TaggedClass<PollDenied>()("PollDenied", {}) {}

export class PollError extends Schema.TaggedClass<PollError>()("PollError", {
  cause: Schema.Defect,
}) {}

export const PollResult = Schema.Union([PollSuccess, PollPending, PollSlow, PollExpired, PollDenied, PollError])
export type PollResult = Schema.Schema.Type<typeof PollResult>
