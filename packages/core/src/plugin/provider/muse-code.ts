import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { MuseCode } from "@opencode/ai/providers/muse-code"
import { Clock, Effect, Schema, Stream } from "effect"
import { App } from "../../app.js"
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
const pollingSafetyMargin = 3000
// Account tokens are long-lived; the expiry only schedules a cheap,
// deduplicated key re-exchange through refresh below.
const credentialLifetime = 90 * 24 * 60 * 60 * 1000

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
})

const device = (app: App.Info) =>
  ({
    integrationID,
    method: {
      id: deviceMethodID,
      type: "oauth",
      label: "Muse Code subscription (device authorization)",
    },
    authorize: () =>
      Effect.gen(function* () {
        const fetched: unknown = yield* Effect.promise(() =>
          fetch("https://auth.meta.com/oidc/device/authorization/", {
            method: "POST",
            headers: headers(app),
            body: new URLSearchParams({ client_id: "1031625952748946" }).toString(),
            redirect: "error",
          }).then((response) => response.json()),
        )
        const started = yield* Clock.currentTimeMillis
        const value = yield* Effect.try(() => Schema.decodeUnknownSync(Device)(fetched))
        const url = value.verification_uri_complete ?? value.verification_uri
        if (!url.startsWith("https://auth.meta.com/"))
          return yield* Effect.fail(new Error("Muse Code returned an unverified authorization URL."))
        const lifetime = positiveSeconds(value.expires_in, 0)
        return {
          mode: "auto" as const,
          url,
          instructions: `Enter code: ${value.user_code}.`,
          ...(lifetime ? { expiresAt: started + lifetime * 1000 } : {}),
          callback: Effect.gen(function* () {
            const accountToken = yield* Effect.promise(() =>
              MuseCode.pollDeviceToken(value.device_code, fetch, {
                intervalMs: Math.max(positiveSeconds(value.interval, 5) * 1000, 1000),
                deadline: started + positiveSeconds(value.expires_in, 300) * 1000,
              }),
            )
            return yield* credential(deviceMethodID, accountToken)
          }),
        }
      }),
    refresh: (value) => credential(deviceMethodID, value.refresh),
    label: (value) =>
      typeof value.metadata?.["accountId"] === "string" ? (value.metadata["accountId"] as string) : undefined,
  }) satisfies IntegrationOAuthMethodRegistration

// The subscription key exchange is the only place an inference key is
// minted. There is no refresh-token grant: refresh re-exchanges the stored
// account token, which never leaves the credential layer for inference or
// discovery except as its own bearer to the key endpoint.
function credential(methodID: Integration.MethodID, accountToken: string) {
  return Effect.promise(() => MuseCode.exchangeSubscriptionKey(accountToken, true)).pipe(
    Effect.map((subscription) =>
      Credential.OAuth.make({
        type: "oauth",
        methodID,
        refresh: accountToken,
        access: subscription.apiKey ?? "",
        expires: Date.now() + credentialLifetime,
        metadata: subscription.accountID ? { accountId: subscription.accountID } : undefined,
      }),
    ),
  )
}

export const MuseCodePlugin = define({
  id: "opencode.provider.muse-code",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    let subscription: Credential.OAuth | undefined

    const load = Effect.fn("MuseCodePlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const value = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      subscription =
        value?.type === "oauth" && value.methodID === deviceMethodID && value.access !== "" ? value : undefined
    })

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Muse Code (Subscription)"
      })
      // Subscription only: no API-key or environment method, so a Meta PAYG
      // key can never authenticate this provider.
      editor.method.update(device(ctx.app))
    })
    yield* load()
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (draft) => {
        draft.name = "Muse Code (Subscription)"
        draft.activation = "auto"
        draft.package = "@opencode/ai/providers/muse-code"
        draft.integrationID = integrationID
        draft.settings = Provider.mergeOverlay(draft.settings, { baseURL: "https://api.meta.ai/v1" })
      })
      // Entitled models only: the provider row (and therefore /connect stays
      // visible before login, but no bundled model is presented as access.
      if (!subscription) return
      for (const apiID of MuseCode.KNOWN_IDS) {
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
    const reload = () => load().pipe(Effect.andThen(ctx.catalog.reload()))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function headers(app: App.Info) {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": App.useragent(app),
  }
}

function positiveSeconds(value: unknown, fallback: number) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback
}
