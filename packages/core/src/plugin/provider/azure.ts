import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Clock, Effect, Schema, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { AppProcess } from "@opencode-ai/util/process"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { iife } from "../../util/iife.js"
import { which } from "../../util/which.js"
import { configuredSettings } from "./configured.js"

const cognitiveScope = "https://cognitiveservices.azure.com/.default"
const foundryScope = "https://ai.azure.com/.default"
const methodID = Integration.MethodID.make("azure-cli")
const decodeJSON = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const decodeProfile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ subscriptions: Schema.Array(Schema.Unknown) })),
)
const decodeToken = Schema.decodeUnknownEffect(
  Schema.Struct({
    accessToken: Schema.NonEmptyString,
    expires_on: Schema.optional(Schema.Number),
    expiresOn: Schema.optional(Schema.NonEmptyString),
  }),
)
const decodeAccounts = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, resourceGroup: Schema.NonEmptyString })),
)
const Deployments = Schema.Array(
  Schema.Struct({
    name: Schema.NonEmptyString,
    properties: Schema.Struct({
      model: Schema.Struct({ name: Schema.NonEmptyString }),
      provisioningState: Schema.NonEmptyString,
    }),
  }),
)
const decodeDeployments = Schema.decodeUnknownEffect(Deployments)

function selectLanguage(sdk: any, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) return sdk.chat(modelID)
  if (sdk.responses) return sdk.responses(modelID)
  if (sdk.messages) return sdk.messages(modelID)
  if (sdk.chat) return sdk.chat(modelID)
  return sdk.languageModel(modelID)
}

export const AzurePlugin = define({
  id: "opencode.provider.azure",
  effect: Effect.fn(function* (ctx) {
    const configured = yield* configuredSettings(Provider.ID.azure)
    const processes = yield* AppProcess.Service
    const bus = yield* Bus.Service
    const tokens = new Map<string, { access: string; expires: number }>()
    const loading = Semaphore.makeUnsafe(1)
    const loaded: { resource?: string; deployments?: typeof Deployments.Type } = {}

    const command = (args: string[]) =>
      processes
        .run(ChildProcess.make("az", args, { extendEnv: true, stdin: "ignore" }), { timeout: "10 seconds" })
        .pipe(
          Effect.flatMap(AppProcess.requireSuccess),
          Effect.flatMap((result) => decodeJSON(result.stdout.toString("utf8"))),
        )

    const token = Effect.fn("AzurePlugin.token")(function* (scope: string) {
      const now = yield* Clock.currentTimeMillis
      const cached = tokens.get(scope)
      if (cached && cached.expires - now > 5 * 60_000) return cached
      const result = yield* command(["account", "get-access-token", "--scope", scope, "--output", "json"]).pipe(
        Effect.flatMap(decodeToken),
      )
      const expires = result.expires_on !== undefined ? result.expires_on * 1000 : Date.parse(result.expiresOn ?? "")
      if (!Number.isFinite(expires))
        return yield* Effect.fail(new Error("Azure CLI returned an invalid token expiration"))
      const refreshed = { access: result.accessToken, expires }
      tokens.set(scope, refreshed)
      return refreshed
    })

    const available = Boolean(which("az"))
    // Installing Azure CLI does not mean the user has signed in. Avoid spawning it for unrelated CLI commands.
    const signedIn = available
      ? yield* Effect.tryPromise(() =>
          readFile(join(process.env.AZURE_CONFIG_DIR ?? join(homedir(), ".azure"), "azureProfile.json"), "utf8"),
        ).pipe(
          Effect.flatMap((text) => decodeProfile(text.replace(/^\uFEFF/, ""))),
          Effect.map((profile) => profile.subscriptions.length > 0),
          Effect.orElseSucceed(() => false),
        )
      : false
    const accounts =
      !resolveResourceName(configured) &&
      typeof configured?.baseURL !== "string" &&
      !process.env.AZURE_RESOURCE_GROUP &&
      signedIn
        ? yield* command(["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"]).pipe(
            Effect.flatMap(decodeAccounts),
            Effect.orElseSucceed(() => []),
          )
        : []

    const form = (select = false) =>
      iife(() => {
        if (resolveResourceName(configured) || typeof configured?.baseURL === "string") return
        return Form.Fields.make([
          {
            type: "string",
            key: "resourceName",
            title: "Enter Azure Resource Name",
            placeholder: "e.g. my-models",
            required: true,
            ...(select && accounts.length > 0
              ? {
                  options: accounts.map((account) => ({
                    value: account.name,
                    label: account.name,
                    description: account.resourceGroup,
                  })),
                  custom: true,
                }
              : {}),
          },
        ])
      })

    yield* ctx.integration.transform((draft) => {
      draft.method.update({
        integrationID: Provider.ID.azure,
        method: { type: "key", label: "API key", form: form() },
      })
      if (!available) return
      draft.method.update({
        integrationID: Provider.ID.azure,
        method: {
          id: methodID,
          type: "oauth",
          label: "Microsoft Entra ID (Azure CLI)",
          form: form(true),
        },
        authorize: (answer) =>
          Effect.succeed({
            mode: "auto" as const,
            url: "",
            instructions: "Sign in with `az login` before continuing.",
            callback: Effect.gen(function* () {
              const resourceName =
                typeof answer.resourceName === "string" ? answer.resourceName : resolveResourceName(configured)
              if (!resourceName) return yield* Effect.fail(new Error("Azure resource name is required"))
              const current = yield* token(cognitiveScope)
              loaded.resource = resourceName
              loaded.deployments = yield* discover(resourceName)
              yield* ctx.catalog.reload()
              return Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: current.access,
                refresh: "azure-cli",
                expires: current.expires,
                metadata: { resourceName },
              })
            }),
          }),
        refresh: (credential) =>
          token(cognitiveScope).pipe(
            Effect.map((current) =>
              Credential.OAuth.make({ ...credential, access: current.access, expires: current.expires }),
            ),
          ),
      })
    })

    const discover = Effect.fn("AzurePlugin.discover")(function* (resource: string) {
      return yield* Effect.gen(function* () {
        const group = process.env.AZURE_RESOURCE_GROUP
        const account = group
          ? { name: resource, resourceGroup: group }
          : (accounts.length > 0
              ? accounts
              : yield* command(["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"]).pipe(
                  Effect.flatMap(decodeAccounts),
                )
            ).find((item) => item.name.toLowerCase() === resource.toLowerCase())
        if (!account)
          return yield* Effect.fail(new Error(`Azure resource "${resource}" was not found in the active subscription`))
        return yield* command([
          "cognitiveservices",
          "account",
          "deployment",
          "list",
          "--name",
          account.name,
          "--resource-group",
          account.resourceGroup,
          "--output",
          "json",
          "--only-show-errors",
        ]).pipe(Effect.flatMap(decodeDeployments))
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Azure model discovery failed", {
            resource,
            error: error instanceof Error ? error.message : String(error),
          }).pipe(Effect.as(undefined)),
        ),
      )
    })

    const load = Effect.fn("AzurePlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(Provider.ID.azure)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (credential?.type !== "oauth" || credential.methodID !== methodID) {
        loaded.resource = undefined
        loaded.deployments = undefined
        return
      }
      const resource =
        typeof credential.metadata?.resourceName === "string" ? credential.metadata.resourceName : undefined
      loaded.resource = resource
      loaded.deployments = resource ? yield* discover(resource) : undefined
    })

    yield* load()
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (item.provider.id !== Provider.ID.azure && Provider.packageName(item.provider.package) !== "@ai-sdk/azure")
          continue
        const resourceName = resolveResourceName(item.provider.settings, loaded.resource)
        if (resourceName)
          evt.provider.update(item.provider.id, (provider) => {
            provider.settings = {
              ...provider.settings,
              resourceName,
              ...(typeof provider.settings?.baseURL === "string"
                ? { baseURL: expandResourceName(provider.settings.baseURL, resourceName) }
                : {}),
            }
          })
        if (item.provider.id === Provider.ID.azure && loaded.deployments) {
          // Startup batches catalog transforms, so match against the current draft rather than a pre-startup snapshot.
          const existing = Array.from(item.models.values())
          const found = new Map<Model.ID, Model.Info>()
          loaded.deployments.forEach((deployment) => {
            if (deployment.properties.provisioningState !== "Succeeded") return
            const model = existing.find(
              (model) => model.id.toLowerCase() === deployment.properties.model.name.toLowerCase(),
            )
            if (!model) return
            const id = found.has(model.id) ? Model.ID.make(deployment.name) : model.id
            found.set(id, {
              ...model,
              id,
              name: id === model.id ? model.name : `${model.name} (${deployment.name})`,
              modelID: Model.ID.make(deployment.name),
            })
          })
          for (const id of Array.from(item.models.keys())) {
            if (!found.has(Model.ID.make(id))) evt.model.remove(item.provider.id, id)
          }
          for (const [id, model] of found) {
            evt.model.update(item.provider.id, id, (draft) => Object.assign(draft, structuredClone(model)))
          }
        }
        for (const model of item.models.values()) {
          evt.model.update(item.provider.id, model.id, (draft) => {
            if (resourceName && typeof draft.settings?.baseURL === "string")
              draft.settings.baseURL = expandResourceName(
                draft.settings.baseURL,
                resolveResourceName(draft.settings, resourceName) ?? resourceName,
              )
            if (responsesWebSocketCapable(item.provider, draft)) draft.capabilities.responsesWebsockets = true
          })
        }
      }
    })

    const reload = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("azure")),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.session.hook(
      "http.request",
      (evt) =>
        Effect.gen(function* () {
          if (evt.model.providerID !== Provider.ID.azure) return
          const connection = yield* ctx.integration.connection.active(Provider.ID.azure)
          const credential = connection
            ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
            : undefined
          if (credential?.type !== "oauth" || credential.methodID !== methodID) return
          const url = new URL(evt.request.url)
          const scope =
            url.hostname.endsWith(".services.ai.azure.com") && !url.pathname.startsWith("/models")
              ? foundryScope
              : cognitiveScope
          const current = yield* token(scope).pipe(Effect.orDie)
          evt.request.headers.delete("api-key")
          evt.request.headers.delete("x-api-key")
          evt.request.headers.set("authorization", `Bearer ${current.access}`)
          evt.request.headers.set("user-agent", App.useragent(ctx.app))
        }),
      { providerID: Provider.ID.azure },
    )

    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/azure") return
        if (evt.model.providerID === Provider.ID.azure) {
          if (
            !evt.options.resourceName &&
            !evt.options.baseURL &&
            (!Provider.isAISDK(evt.model.package) || typeof evt.model.settings?.baseURL !== "string")
          ) {
            throw new Error("Azure resource name is missing; set AZURE_RESOURCE_NAME or configure resourceName/baseURL")
          }
        }
        const mod = yield* Effect.promise(() => import("@ai-sdk/azure"))
        evt.sdk = mod.createAzure(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.azure) return
        evt.language = selectLanguage(
          evt.sdk,
          evt.model.modelID ?? evt.model.id,
          Boolean(evt.options.useCompletionUrls),
        )
      }),
    )
  }),
})

function resolveResourceName(settings: Readonly<Record<string, unknown>> | undefined, fallback?: string) {
  const configured = settings?.resourceName
  if (typeof configured === "string" && configured.trim() !== "") return configured
  return fallback ?? process.env.AZURE_RESOURCE_NAME ?? process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
}

function expandResourceName(baseURL: string, resourceName: string) {
  return baseURL
    .replaceAll("${AZURE_RESOURCE_NAME}", resourceName)
    .replaceAll("${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}", resourceName)
}

function responsesWebSocketCapable(provider: Provider.Info, model: Model.Info) {
  if (Provider.packageName(model.package ?? provider.package) !== "@ai-sdk/azure") return false
  const settings = Provider.mergeOverlay(provider.settings, model.settings)
  if (settings?.useCompletionUrls === true || settings?.useDeploymentBasedUrls === true) return false
  if (settings?.apiVersion !== undefined && settings.apiVersion !== "v1") return false
  if (typeof settings?.baseURL !== "string") return true
  return /^https:\/\/[^/]+\.openai\.azure\.com(?:\/|$)/i.test(settings.baseURL)
}
