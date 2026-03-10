import { Clock, Effect, Layer, Option, Schema, ServiceMap } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"

import { withTransientReadRetry } from "@/util/effect-http-client"
import { AccountRepo, type AccountRow } from "./repo"
import {
  type AccountError,
  AccessToken,
  Account,
  AccountID,
  AccountServiceError,
  Login,
  Org,
  OrgID,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
} from "./schema"

export * from "./schema"

export type AccountOrgs = {
  account: Account
  orgs: Org[]
}

const RemoteOrg = Schema.Struct({
  id: Schema.optional(OrgID),
  name: Schema.optional(Schema.String),
})

const RemoteOrgs = Schema.Array(RemoteOrg)

const RemoteConfig = Schema.Struct({
  config: Schema.Record(Schema.String, Schema.Json),
})

const TokenRefresh = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})

const DeviceCode = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri_complete: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
})

const DeviceToken = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
})

const User = Schema.Struct({
  id: Schema.optional(AccountID),
  email: Schema.optional(Schema.String),
})

const ClientId = Schema.Struct({ client_id: Schema.String })

const DeviceTokenRequest = Schema.Struct({
  grant_type: Schema.String,
  device_code: Schema.String,
  client_id: Schema.String,
})

const clientId = "opencode-cli"

const toAccountServiceError = (message: string, cause?: unknown) => new AccountServiceError({ message, cause })

const mapAccountServiceError =
  (operation: string, message = "Account service operation failed") =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, AccountServiceError, R> =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof AccountServiceError ? error : toAccountServiceError(`${message} (${operation})`, error),
      ),
    )

export class AccountService extends ServiceMap.Service<
  AccountService,
  {
    readonly active: () => Effect.Effect<Option.Option<Account>, AccountError>
    readonly list: () => Effect.Effect<Account[], AccountError>
    readonly orgsByAccount: () => Effect.Effect<AccountOrgs[], AccountError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountError>
    readonly orgs: (accountID: AccountID) => Effect.Effect<Org[], AccountError>
    readonly config: (
      accountID: AccountID,
      orgID: OrgID,
    ) => Effect.Effect<Option.Option<Record<string, unknown>>, AccountError>
    readonly token: (accountID: AccountID) => Effect.Effect<Option.Option<AccessToken>, AccountError>
    readonly login: (url: string) => Effect.Effect<Login, AccountError>
    readonly poll: (input: Login) => Effect.Effect<PollResult, AccountError>
  }
>()("@opencode/Account") {
  static readonly layer: Layer.Layer<AccountService, never, AccountRepo | HttpClient.HttpClient> = Layer.effect(
    AccountService,
    Effect.gen(function* () {
      const repo = yield* AccountRepo
      const http = yield* HttpClient.HttpClient
      const httpRead = withTransientReadRetry(http)

      const execute = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
        http.execute(request).pipe(mapAccountServiceError(operation, "HTTP request failed"))

      const executeRead = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
        httpRead.execute(request).pipe(mapAccountServiceError(operation, "HTTP request failed"))

      const executeEffect = <E>(operation: string, request: Effect.Effect<HttpClientRequest.HttpClientRequest, E>) =>
        request.pipe(
          Effect.flatMap((req) => http.execute(req)),
          mapAccountServiceError(operation, "HTTP request failed"),
        )

      const okOrNone = (operation: string, response: HttpClientResponse.HttpClientResponse) =>
        HttpClientResponse.filterStatusOk(response).pipe(
          Effect.map(Option.some),
          Effect.catch((error) =>
            HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError"
              ? Effect.succeed(Option.none<HttpClientResponse.HttpClientResponse>())
              : Effect.fail(error),
          ),
          mapAccountServiceError(operation),
        )

      const tokenForRow = Effect.fn("AccountService.tokenForRow")(function* (found: AccountRow) {
        const now = yield* Clock.currentTimeMillis
        if (found.token_expiry && found.token_expiry > now) return Option.some(AccessToken.make(found.access_token))

        const response = yield* execute(
          "token.refresh",
          HttpClientRequest.post(`${found.url}/oauth/token`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyUrlParams({
              grant_type: "refresh_token",
              refresh_token: found.refresh_token,
            }),
          ),
        )

        const ok = yield* okOrNone("token.refresh", response)
        if (Option.isNone(ok)) return Option.none()

        const parsed = yield* HttpClientResponse.schemaBodyJson(TokenRefresh)(ok.value).pipe(
          mapAccountServiceError("token.refresh", "Failed to decode response"),
        )

        const expiry = Option.fromNullishOr(parsed.expires_in).pipe(Option.map((e) => now + e * 1000))

        yield* repo.persistToken({
          accountID: AccountID.make(found.id),
          accessToken: parsed.access_token,
          refreshToken: parsed.refresh_token ?? found.refresh_token,
          expiry,
        })

        return Option.some(AccessToken.make(parsed.access_token))
      })

      const resolveAccess = Effect.fn("AccountService.resolveAccess")(function* (accountID: AccountID) {
        const maybeAccount = yield* repo.getRow(accountID)
        if (Option.isNone(maybeAccount)) return Option.none<{ account: AccountRow; accessToken: AccessToken }>()

        const account = maybeAccount.value
        const accessToken = yield* tokenForRow(account)
        if (Option.isNone(accessToken)) return Option.none<{ account: AccountRow; accessToken: AccessToken }>()

        return Option.some({ account, accessToken: accessToken.value })
      })

      const token = Effect.fn("AccountService.token")((accountID: AccountID) =>
        resolveAccess(accountID).pipe(Effect.map(Option.map((r) => r.accessToken))),
      )

      const orgsByAccount = Effect.fn("AccountService.orgsByAccount")(function* () {
        const accounts = yield* repo.list()
        return yield* Effect.forEach(
          accounts,
          (account) => orgs(account.id).pipe(Effect.map((orgs) => ({ account, orgs }))),
          { concurrency: 3 },
        )
      })

      const orgs = Effect.fn("AccountService.orgs")(function* (accountID: AccountID) {
        const resolved = yield* resolveAccess(accountID)
        if (Option.isNone(resolved)) return []

        const { account, accessToken } = resolved.value

        const response = yield* executeRead(
          "orgs",
          HttpClientRequest.get(`${account.url}/api/orgs`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(accessToken),
          ),
        )

        const ok = yield* okOrNone("orgs", response)
        if (Option.isNone(ok)) return []

        const orgs = yield* HttpClientResponse.schemaBodyJson(RemoteOrgs)(ok.value).pipe(
          mapAccountServiceError("orgs", "Failed to decode response"),
        )
        return orgs
          .filter((org) => org.id !== undefined && org.name !== undefined)
          .map((org) => new Org({ id: org.id!, name: org.name! }))
      })

      const config = Effect.fn("AccountService.config")(function* (accountID: AccountID, orgID: OrgID) {
        const resolved = yield* resolveAccess(accountID)
        if (Option.isNone(resolved)) return Option.none()

        const { account, accessToken } = resolved.value

        const response = yield* executeRead(
          "config",
          HttpClientRequest.get(`${account.url}/api/config`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(accessToken),
            HttpClientRequest.setHeaders({ "x-org-id": orgID }),
          ),
        )

        const ok = yield* okOrNone("config", response)
        if (Option.isNone(ok)) return Option.none()

        const parsed = yield* HttpClientResponse.schemaBodyJson(RemoteConfig)(ok.value).pipe(
          mapAccountServiceError("config", "Failed to decode response"),
        )
        return Option.some(parsed.config)
      })

      const login = Effect.fn("AccountService.login")(function* (server: string) {
        const response = yield* executeEffect(
          "login",
          HttpClientRequest.post(`${server}/auth/device/code`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.schemaBodyJson(ClientId)({ client_id: clientId }),
          ),
        )

        const ok = yield* okOrNone("login", response)
        if (Option.isNone(ok)) {
          const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
          return yield* toAccountServiceError(`Failed to initiate device flow: ${body || response.status}`)
        }

        const parsed = yield* HttpClientResponse.schemaBodyJson(DeviceCode)(ok.value).pipe(
          mapAccountServiceError("login", "Failed to decode response"),
        )
        return new Login({
          code: parsed.device_code,
          user: parsed.user_code,
          url: `${server}${parsed.verification_uri_complete}`,
          server,
          expiry: parsed.expires_in,
          interval: parsed.interval,
        })
      })

      const poll = Effect.fn("AccountService.poll")(function* (input: Login) {
        const response = yield* executeEffect(
          "poll",
          HttpClientRequest.post(`${input.server}/auth/device/token`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.schemaBodyJson(DeviceTokenRequest)({
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              device_code: input.code,
              client_id: clientId,
            }),
          ),
        )

        const parsed = yield* HttpClientResponse.schemaBodyJson(DeviceToken)(response).pipe(
          mapAccountServiceError("poll", "Failed to decode response"),
        )

        if (!parsed.access_token) {
          if (parsed.error === "authorization_pending") return new PollPending()
          if (parsed.error === "slow_down") return new PollSlow()
          if (parsed.error === "expired_token") return new PollExpired()
          if (parsed.error === "access_denied") return new PollDenied()
          return new PollError({ cause: parsed.error })
        }

        const access = parsed.access_token

        const fetchUser = executeRead(
          "poll.user",
          HttpClientRequest.get(`${input.server}/api/user`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(access),
          ),
        ).pipe(
          Effect.flatMap((r) =>
            HttpClientResponse.schemaBodyJson(User)(r).pipe(
              mapAccountServiceError("poll.user", "Failed to decode response"),
            ),
          ),
        )

        const fetchOrgs = executeRead(
          "poll.orgs",
          HttpClientRequest.get(`${input.server}/api/orgs`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(access),
          ),
        ).pipe(
          Effect.flatMap((r) =>
            HttpClientResponse.schemaBodyJson(RemoteOrgs)(r).pipe(
              mapAccountServiceError("poll.orgs", "Failed to decode response"),
            ),
          ),
        )

        const [user, remoteOrgs] = yield* Effect.all([fetchUser, fetchOrgs], { concurrency: 2 })

        const userId = user.id
        const userEmail = user.email

        if (!userId || !userEmail) {
          return new PollError({ cause: "No id or email in response" })
        }

        const firstOrgID = remoteOrgs.length > 0 ? Option.fromNullishOr(remoteOrgs[0].id) : Option.none()

        const now = yield* Clock.currentTimeMillis
        const expiry = now + (parsed.expires_in ?? 0) * 1000
        const refresh = parsed.refresh_token ?? ""
        if (!refresh) {
          yield* Effect.logWarning(
            "Server did not return a refresh token — session may expire without ability to refresh",
          )
        }

        yield* repo.persistAccount({
          id: userId,
          email: userEmail,
          url: input.server,
          accessToken: access,
          refreshToken: refresh,
          expiry,
          orgID: firstOrgID,
        })

        return new PollSuccess({ email: userEmail })
      })

      return AccountService.of({
        active: repo.active,
        list: repo.list,
        orgsByAccount,
        remove: repo.remove,
        use: repo.use,
        orgs,
        config,
        token,
        login,
        poll,
      })
    }),
  )

  static readonly defaultLayer = AccountService.layer.pipe(
    Layer.provide(AccountRepo.layer),
    Layer.provide(FetchHttpClient.layer),
  )
}
