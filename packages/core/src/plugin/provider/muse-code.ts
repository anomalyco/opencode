import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { MuseCode } from "@opencode/ai/providers/muse-code"
import { Clock, Effect, Semaphore, Stream } from "effect"
import { Credential } from "../../credential.js"
import { Bus } from "../../bus.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

// Verified Muse release dates come from the models.dev snapshot; 1.3 has no
// snapshot entry yet so it sorts last until its date is known.
const RELEASED: Record<string, number> = {
  "muse-spark-1.1": Date.parse("2026-04-08"),
  "muse-spark-1.2": Date.parse("2026-08-05"),
  "muse-spark-1.2-contributor": Date.parse("2026-08-05"),
}

const providerID = Provider.ID.make("muse-code")
const integrationID = Integration.ID.make("muse-code")
const deviceMethodID = Integration.MethodID.make("device")
// The account token carries no advertised lifetime, so expiry is a sentinel:
// failures re-authenticate interactively instead of on a schedule. There is
// no refresh-token grant; the stored account token only ever re-exchanges.
const noAdvertisedExpiry = 8_640_000_000_000_000

const device = (authorize: IntegrationOAuthMethodRegistration["authorize"]) =>
  ({
    integrationID,
    method: {
      id: deviceMethodID,
      type: "oauth",
      label: "Muse Code subscription (device authorization)",
    },
    // Single auth implementation: the ai package owns device validation,
    // polling, and key exchange; this layer only forwards cancellation.
    authorize,
    label: (value) =>
      typeof value.metadata?.["accountId"] === "string" ? (value.metadata["accountId"] as string) : undefined,
  }) satisfies IntegrationOAuthMethodRegistration

export const MuseCodePlugin = define({
  id: "opencode.provider.muse-code",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const exchangeLock = yield* Semaphore.make(1)
    // Account-scoped key-endpoint backoff, mirroring the established
    // lifecycle: concurrent exchanges share one flight, and Retry-After is
    // honored without touching another account.
    const backoff = new Map<string, number>()
    let subscription: Credential.OAuth | undefined
    let entitled: string[] = []
    let unsupported: string[] = []

    // The subscription key exchange is the only place an inference key is
    // minted. Quota is informational and redacted; a quota failure never
    // fails the login the key exchange already validated.
    const exchangeAccount = (accountToken: string) =>
      exchangeLock.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const until = backoff.get(accountToken) ?? 0
          if (now < until) return yield* Effect.fail(new MuseCode.RateLimitedError(until - now))
          const subscriptionKey = yield* Effect.tryPromise({
            try: (signal) => MuseCode.exchangeSubscriptionKey(accountToken, true, fetch, signal),
            catch: (cause) => cause,
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (error instanceof MuseCode.RateLimitedError) {
                  const at = yield* Clock.currentTimeMillis
                  backoff.set(accountToken, at + error.retryAfterMs)
                }
                return yield* Effect.fail(error)
              }),
            ),
          )
          const quota = yield* Effect.tryPromise({
            try: (signal) => MuseCode.fetchQuota(accountToken, fetch, signal),
            catch: (cause) => cause,
          }).pipe(Effect.orElseSucceed(() => ({ active: true, windows: [] as MuseCode.QuotaWindow[] })))
          return Credential.OAuth.make({
            type: "oauth",
            methodID: deviceMethodID,
            refresh: accountToken,
            access: subscriptionKey.apiKey ?? "",
            expires: noAdvertisedExpiry,
            metadata: {
              ...(subscriptionKey.accountID ? { accountId: subscriptionKey.accountID } : {}),
              quota: quota.windows,
            },
          })
        }),
      )

    const refreshData = Effect.fn("MuseCodePlugin.refresh")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const value = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      subscription =
        value?.type === "oauth" && value.methodID === deviceMethodID && value.access !== "" ? value : undefined
      entitled = []
      unsupported = []
      const active = subscription
      if (!active) return
      const discovered = yield* Effect.tryPromise({
        try: (signal) => MuseCode.discoverModelIDs(active.access, fetch, signal),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (!discovered) {
        yield* Effect.logWarning("Muse Code model discovery unavailable; registering no models.")
        return
      }
      entitled = discovered.entitled.filter((id) => MuseCode.KNOWN_IDS.includes(id))
      unsupported = discovered.unknown
      if (unsupported.length > 0)
        yield* Effect.logInfo(`Muse Code returned ${unsupported.length} unsupported model revision(s); skipped.`)
      if (entitled.length === 0)
        yield* Effect.logInfo("Muse Code reports no entitled models for this account; registering none.")
    })

    const authorize = () =>
      Effect.gen(function* () {
        const authorization = yield* Effect.tryPromise({
          try: (signal) => MuseCode.startDeviceAuthorization(fetch, signal),
          catch: (cause) => cause,
        })
        const started = yield* Clock.currentTimeMillis
        return {
          mode: "auto" as const,
          url: authorization.url,
          instructions: authorization.instructions,
          ...(authorization.expiresIn ? { expiresAt: started + authorization.expiresIn * 1000 } : {}),
          callback: Effect.gen(function* () {
            const accountToken = yield* Effect.tryPromise({
              try: (signal) =>
                MuseCode.pollDeviceToken(authorization.deviceCode, fetch, {
                  intervalMs: authorization.intervalMs,
                  deadline: started + authorization.expiresIn * 1000,
                  signal,
                }),
              catch: (cause) => cause,
            })
            return yield* exchangeAccount(accountToken)
          }),
        }
      })

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Muse Code (Subscription)"
      })
      // Subscription only: no API-key or environment method, so a Meta PAYG
      // key can never authenticate this provider.
      editor.method.update(device(authorize))
    })
    yield* refreshData()
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (draft) => {
        draft.name = "Muse Code (Subscription)"
        draft.activation = "auto"
        draft.package = "@opencode/ai/providers/muse-code"
        draft.integrationID = integrationID
        draft.settings = Provider.mergeOverlay(draft.settings, { baseURL: "https://api.meta.ai/v1" })
      })
      // Entitled models only: the provider row keeps /connect visible before
      // login, but no bundled model is ever presented as confirmed access.
      for (const apiID of entitled) {
        const modelID = Model.ID.make(apiID)
        catalog.model.update(providerID, modelID, (draft) => {
          Object.assign(draft, {
            ...Model.Info.default(providerID, modelID),
            id: modelID,
            modelID,
            providerID,
            name: MuseCode.NAMES[apiID as keyof typeof MuseCode.NAMES],
            family: Model.Family.make("muse"),
            package: "@opencode/ai/providers/muse-code",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            variants: MuseCode.effortsFor(apiID).map((effort) => ({
              id: Model.VariantID.make(effort),
              settings: MuseCode.variantSettings(effort),
            })),
            limit: { context: MuseCode.LIMITS.context, output: MuseCode.LIMITS.output },
            // Subscription quota is not API usage; never render dollar costs.
            cost: [],
            status: "active" as const,
            enabled: true,
            time: { released: RELEASED[apiID] ?? 0 },
          })
        })
      }
    })
    const reload = () => refreshData().pipe(Effect.andThen(ctx.catalog.reload()))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
