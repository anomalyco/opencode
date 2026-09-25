import { Clock, Effect, Option, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
import { AppProcess } from "@opencode/util/process"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { iife } from "../../util/iife.js"
import { which } from "../../util/which.js"
import type { PluginInternal } from "../internal.js"
import { configuredSettings } from "./configured.js"

const cognitiveScope = "https://cognitiveservices.azure.com/.default"
const foundryScope = "https://ai.azure.com/.default"
const managementScope = "https://management.azure.com/.default"
const methodID = Integration.MethodID.make("azure-cli")
// A resource name becomes a hostname label and a query literal, so anything else never leaves the process.
const resourcePattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/
const decodeJSON = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const decodeToken = Schema.decodeUnknownEffect(
  Schema.Struct({
    accessToken: Schema.NonEmptyString,
    expires_on: Schema.optional(Schema.Number),
    expiresOn: Schema.optional(Schema.NonEmptyString),
  }),
)
const ResourceDeployments = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const decodeResourceDeployment = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.NonEmptyString, model: Schema.NonEmptyString, status: Schema.String }),
)
const ManagementDeployments = Schema.Struct({
  value: Schema.Array(Schema.Unknown),
  nextLink: Schema.optional(Schema.NonEmptyString),
})
const decodeManagementDeployment = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.NonEmptyString,
    properties: Schema.Struct({
      model: Schema.Struct({ name: Schema.NonEmptyString }),
      provisioningState: Schema.String,
    }),
  }),
)
const AccountQuery = Schema.Struct({
  query: Schema.String,
  options: Schema.optional(Schema.Struct({ $skipToken: Schema.String })),
})
const Accounts = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  $skipToken: Schema.optional(Schema.NonEmptyString),
})
const Account = Schema.Struct({
  id: Schema.NonEmptyString,
  resourceName: Schema.NonEmptyString,
  resourceGroup: Schema.String,
  location: Schema.String,
})
const decodeAccount = Schema.decodeUnknownOption(Account)

type Deployment = { readonly name: string; readonly model: string }

export function make(
  endpoints = {
    resource: (name: string) => `https://${name}.openai.azure.com/openai`,
    management: "https://management.azure.com",
  },
) {
  return define({
    id: "opencode.provider.azure",
    effect: Effect.fn(function* (ctx) {
      const configured = yield* configuredSettings(Provider.ID.azure)
      const processes = yield* AppProcess.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const providers = yield* Provider.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const tokens = new Map<string, { access: string; expires: number }>()
      const loading = Semaphore.makeUnsafe(1)
      const loaded: {
        resource?: string
        url?: string
        deployments?: readonly Deployment[]
        connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
      } = {}
      const listed: { accounts: readonly (typeof Account.Type)[] } = { accounts: [] }

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

      const management = (request: HttpClientRequest.HttpClientRequest) =>
        token(managementScope).pipe(
          Effect.flatMap((current) =>
            http.execute(
              request.pipe(
                HttpClientRequest.bearerToken(current.access),
                HttpClientRequest.acceptJson,
                HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
              ),
            ),
          ),
        )

      // Resource Graph spans every subscription of the Azure CLI session, unlike a per-subscription account list.
      const accounts = Effect.fn("AzurePlugin.accounts")(function* (resource?: string) {
        return yield* Stream.paginate(undefined, (skipToken: string | undefined) =>
          HttpClientRequest.post(
            `${endpoints.management}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`,
          ).pipe(
            HttpClientRequest.schemaBodyJson(AccountQuery)({
              query: accountQuery(resource),
              ...(skipToken === undefined ? {} : { options: { $skipToken: skipToken } }),
            }),
            Effect.flatMap(management),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Accounts)),
            Effect.timeout("10 seconds"),
            Effect.map(
              (response) =>
                [
                  response.data.flatMap((item) => Option.toArray(decodeAccount(item))),
                  Option.fromNullishOr(response.$skipToken),
                ] as const,
            ),
          ),
        ).pipe(Stream.runCollect)
      })

      // Runs only while connecting, so listing Azure resources never costs anything at startup.
      const detect = Effect.fn("AzurePlugin.detect")(function* () {
        const found = yield* accounts()
        if (found.length === 1) return found[0].resourceName
        listed.accounts = found
        yield* ctx.integration.reload()
        return yield* Effect.fail(
          new Error(
            found.length === 0
              ? "No Azure resources were found for this Azure CLI session. Connect again and enter the resource name."
              : `Found ${found.length} Azure resources. Connect again to choose one.`,
          ),
        )
      })

      const available = Boolean(which("az"))
      const form = (cli: boolean) =>
        iife(() => {
          if (resolveResourceName(configured) || typeof configured?.baseURL === "string") return
          // Only the Azure CLI session can look the resource up, and only until a lookup found several to choose from.
          const detectable = cli && listed.accounts.length === 0
          return Form.Fields.make([
            {
              type: "string",
              key: "resourceName",
              title: "Enter Azure Resource Name",
              placeholder: "e.g. my-models",
              required: !detectable,
              ...(detectable ? { description: "Leave empty to use the resource of your Azure CLI session" } : {}),
              ...(cli && listed.accounts.length > 0
                ? {
                    options: listed.accounts.map((account) => ({
                      value: account.resourceName,
                      label: account.resourceName,
                      description: `${account.resourceGroup} · ${account.location}`,
                    })),
                    custom: true,
                  }
                : {}),
            },
          ])
        })

      yield* ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID: Provider.ID.azure,
          method: { type: "key", label: "API key", form: form(false) },
        })
        if (!available) return
        editor.method.update({
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
                  (typeof answer.resourceName === "string" ? answer.resourceName.trim() : "") ||
                  resolveResourceName(configured) ||
                  (typeof configured?.baseURL === "string" ? undefined : yield* detect())
                if (!resourceName) return yield* Effect.fail(new Error("Azure resource name is required"))
                const current = yield* token(cognitiveScope)
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

      const load = Effect.fn("AzurePlugin.load")(function* () {
        const connection = yield* ctx.integration.connection.active(Provider.ID.azure)
        // Startup awaits this, so it reads the stored credential: resolving the connection would refresh an
        // expired token through the Azure CLI.
        const stored =
          connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
        return { connection, resource: credentialResource(stored?.value) }
      })

      const managementDeployments = Effect.fn("AzurePlugin.managementDeployments")(function* (resource: string) {
        const account = (yield* accounts(resource))[0]
        if (!account) return yield* Effect.fail(new Error(`Azure resource "${resource}" was not found`))
        return yield* Stream.paginate(
          `${endpoints.management}${account.id}/deployments?api-version=2024-10-01`,
          (url) =>
            management(HttpClientRequest.get(url)).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(ManagementDeployments)),
              Effect.timeout("10 seconds"),
              Effect.map(
                (response) =>
                  [
                    response.value.flatMap((raw): Deployment[] => {
                      const item = Option.getOrUndefined(decodeManagementDeployment(raw))
                      return item?.properties.provisioningState === "Succeeded"
                        ? [{ name: item.name, model: item.properties.model.name }]
                        : []
                    }),
                    Option.fromNullishOr(response.nextLink),
                  ] as const,
              ),
            ),
        ).pipe(Stream.runCollect)
      })

      const deployments = Effect.fn("AzurePlugin.deployments")(function* (
        url: string,
        resource: string,
        credential: Credential.Value,
      ) {
        return yield* http
          .execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
              credential.type === "key"
                ? HttpClientRequest.setHeader("api-key", credential.key)
                : HttpClientRequest.bearerToken(credential.access),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ResourceDeployments)),
            Effect.timeout("10 seconds"),
            Effect.map((response) =>
              response.data.flatMap((raw): Deployment[] => {
                const item = Option.getOrUndefined(decodeResourceDeployment(raw))
                return item?.status === "succeeded" ? [{ name: item.id, model: item.model }] : []
              }),
            ),
            // Azure documents the management API as the deployment inventory, but only an Azure CLI session can
            // reach it. The resource's own inventory comes first because it also answers to an API key.
            Effect.catch((cause) =>
              credential.type === "oauth" ? managementDeployments(resource) : Effect.fail(cause),
            ),
          )
      })

      const sync = () =>
        loading.withPermit(
          Effect.gen(function* () {
            const current = yield* load()
            if (
              IntegrationConnection.key(current.connection) !== IntegrationConnection.key(loaded.connection) ||
              current.resource !== loaded.resource
            ) {
              Object.assign(loaded, current, { url: undefined, deployments: undefined })
              yield* ctx.provider.reload()
            }
            const settings = (yield* providers.get(Provider.ID.azure))?.settings
            const name = loaded.resource ?? resolveResourceName(settings)
            // A custom endpoint may expose other deployments than the resource does, so it keeps the catalog.
            const url =
              current.connection &&
              name !== undefined &&
              resourcePattern.test(name) &&
              typeof settings?.baseURL !== "string"
                ? `${endpoints.resource(name)}/deployments?api-version=2022-12-01`
                : undefined
            // Keep the last inventory through transient failures only for the same connection and resource.
            if (loaded.url !== url) {
              loaded.url = url
              if (loaded.deployments) {
                loaded.deployments = undefined
                yield* ctx.model.reload()
              }
            }
            if (!current.connection || !name || !url) return
            const credential = yield* ctx.integration.connection
              .resolve(current.connection)
              .pipe(Effect.orElseSucceed(() => undefined))
            if (!credential || (credential.type === "oauth" && credential.methodID !== methodID)) return
            const found = yield* deployments(url, name, credential).pipe(
              // Azure promises no order; normalize it so a reordered response does not rebuild the model list.
              Effect.map((list) => list.toSorted((a, b) => a.name.localeCompare(b.name))),
              Effect.catch((cause) =>
                Effect.logWarning("failed to sync Azure deployments", { cause }).pipe(Effect.as(undefined)),
              ),
            )
            if (!found) return
            if (
              IntegrationConnection.key(current.connection) !==
              IntegrationConnection.key(yield* ctx.integration.connection.active(Provider.ID.azure))
            )
              return
            if (JSON.stringify(found) === JSON.stringify(loaded.deployments)) return
            loaded.deployments = found
            yield* ctx.model.reload()
          }),
        )

      Object.assign(loaded, yield* load())
      yield* ctx.provider.transform((evt) => {
        for (const item of evt.list()) {
          if (
            item.provider.id !== Provider.ID.azure &&
            !item.provider.package.startsWith("@opencode/ai/providers/azure/")
          )
            continue
          const resourceName = resolveResourceName(item.provider.settings, loaded.resource)
          const websocket = responsesWebSocketCapable(item.provider)
          if (!resourceName && !websocket) continue
          evt.update(item.provider.id, (provider) => {
            provider.settings = {
              ...provider.settings,
              ...(resourceName === undefined ? {} : { resourceName }),
              ...(websocket ? { transport: provider.settings?.transport ?? "websocket" } : {}),
              ...(resourceName !== undefined && typeof provider.settings?.baseURL === "string"
                ? { baseURL: expandResourceName(provider.settings.baseURL, resourceName) }
                : {}),
            }
          })
        }
        const item = evt.get(Provider.ID.azure)
        if (!item) return
        // Bind resource settings and discovery to their account, so a switch hides them even while sync is busy.
        // Keep the full templates here for explicit configuration; the model transform narrows the visible list.
        evt.add({
          info: item.provider,
          models: Array.from(item.models.values()),
          sourceConnection: loaded.connection,
        })
      })
      yield* ctx.model.transform((models) => {
        for (const item of models.provider.list()) {
          if (
            item.provider.id !== Provider.ID.azure &&
            !item.provider.package.startsWith("@opencode/ai/providers/azure/")
          )
            continue
          const resourceName = resolveResourceName(item.provider.settings, loaded.resource)
          for (const model of models.list(item.provider.id)) {
            models.update(item.provider.id, model.id, (draft) => {
              if (resourceName && typeof draft.settings?.baseURL === "string")
                draft.settings.baseURL = expandResourceName(
                  draft.settings.baseURL,
                  resolveResourceName(draft.settings, resourceName) ?? resourceName,
                )
            })
          }
        }
        if (!loaded.deployments) return
        // Narrowing here rather than in the provider catalog keeps every catalog model available as the base
        // of a model the user configures explicitly; those are applied after this transform.
        const catalog = models.list(Provider.ID.azure)
        const deployed = deployedModels(loaded.deployments, catalog)
        for (const model of catalog) {
          if (!deployed.has(model.id)) models.remove(Provider.ID.azure, model.id)
        }
        for (const [id, model] of deployed) {
          models.update(Provider.ID.azure, id, (draft) => Object.assign(draft, model))
        }
      })

      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filter((event) => event.data.integrationID === Integration.ID.make("azure")),
        Stream.runForEach(sync),
        Effect.forkScoped({ startImmediately: true }),
      )
      // Deployments load in the background so startup never waits on Azure; the catalog serves until they arrive,
      // and the last inventory is retained through transient failures.
      yield* sync().pipe(Effect.repeat(Schedule.spaced("5 minutes")), Effect.forkScoped)

      // Entra bearer tokens are minted per request from the target URL's scope, so they are injected
      // at the transport hooks rather than stored as a credential.
      const bearer = Effect.fn("AzurePlugin.bearer")(function* (url: string) {
        const connection = yield* ctx.integration.connection.active(Provider.ID.azure)
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        if (credential?.type !== "oauth" || credential.methodID !== methodID) return
        const target = new URL(url)
        const scope =
          target.hostname.endsWith(".services.ai.azure.com") && !target.pathname.startsWith("/models")
            ? foundryScope
            : cognitiveScope
        const current = yield* token(scope).pipe(Effect.orDie)
        return `Bearer ${current.access}`
      })
      yield* ctx.session.hook(
        "http.request",
        (evt) =>
          Effect.gen(function* () {
            if (evt.model.providerID !== Provider.ID.azure) return
            const authorization = yield* bearer(evt.request.url)
            if (!authorization) return
            evt.request.headers.delete("api-key")
            evt.request.headers.delete("x-api-key")
            evt.request.headers.set("authorization", authorization)
            evt.request.headers.set("user-agent", App.useragent(ctx.app))
          }),
        { providerID: Provider.ID.azure },
      )
      yield* ctx.session.hook(
        "experimental.ws.handshake",
        (evt) =>
          Effect.gen(function* () {
            if (evt.model.providerID !== Provider.ID.azure) return
            const authorization = yield* bearer(evt.url)
            if (!authorization) return
            delete evt.headers["api-key"]
            delete evt.headers["x-api-key"]
            evt.headers.authorization = authorization
            evt.headers["user-agent"] = App.useragent(ctx.app)
          }),
        { providerID: Provider.ID.azure },
      )
    }),
  } satisfies PluginInternal.InternalPlugin)
}

export const AzurePlugin = make()

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

// The Azure CLI method stores the resource as credential metadata, the API key method as its form answer.
function credentialResource(credential: Credential.Value | undefined) {
  const resource =
    credential?.type === "key"
      ? credential.configuration?.resourceName
      : credential?.methodID === methodID
        ? credential.metadata?.resourceName
        : undefined
  return typeof resource === "string" && resource.trim() !== "" ? resource : undefined
}

function accountQuery(resource?: string) {
  return [
    "resources",
    "| where type =~ 'microsoft.cognitiveservices/accounts' and kind in~ ('AIServices', 'OpenAI')",
    // The custom subdomain is the resource name of every endpoint, and Entra ID authentication requires one.
    "| extend resourceName = tostring(properties.customSubDomainName)",
    resource === undefined ? "| where isnotempty(resourceName)" : `| where resourceName =~ '${resource}'`,
    "| project id, resourceName, resourceGroup, location",
    "| order by resourceName asc",
  ].join(" ")
}

// Azure addresses a model by its deployment name, while limits, costs, and routes belong to the catalog model it
// deploys. A deployment of a model the catalog does not know has none of those and is left to explicit configuration.
function deployedModels(deployments: readonly Deployment[], catalog: readonly Model.MutableInfo[]) {
  const models = new Map(catalog.map((model) => [model.id.toLowerCase(), model]))
  return deployments.reduce((result, deployment) => {
    const model = models.get(deployment.model.toLowerCase())
    if (!model) return result
    // A deployment's ID must not depend on which other deployments happen to exist.
    const id = deployment.name.toLowerCase() === model.id.toLowerCase() ? model.id : Model.ID.make(deployment.name)
    if (result.has(id)) return result
    return result.set(id, {
      ...structuredClone(model),
      id,
      modelID: Model.ID.make(deployment.name),
      name: id === model.id ? model.name : `${model.name} (${deployment.name})`,
    })
  }, new Map<Model.ID, Model.MutableInfo>())
}

function responsesWebSocketCapable(provider: Provider.Info) {
  if (provider.package !== "@opencode/ai/providers/azure/responses") return false
  const settings = provider.settings
  if (settings?.useDeploymentBasedUrls === true) return false
  if (settings?.apiVersion !== undefined && settings.apiVersion !== "v1") return false
  if (typeof settings?.baseURL !== "string") return true
  return /^https:\/\/[^/]+\.openai\.azure\.com(?:\/|$)/i.test(settings.baseURL)
}
