import { Clock, Effect, FiberHandle, Option, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
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
// A resource name becomes a hostname label and a query literal, so anything else never leaves the process. Azure
// allows only letters, digits, and hyphens in it.
// https://learn.microsoft.com/azure/ai-services/cognitive-services-custom-subdomains
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
const ResourceQuery = Schema.Struct({
  query: Schema.String,
  options: Schema.optional(Schema.Struct({ $top: Schema.Number })),
})
const Resources = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })) })
const ResourceListing = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const decodeProfile = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ subscriptions: Schema.NonEmptyArray(Schema.Unknown) })),
)
const decodeResourceListing = Schema.decodeUnknownOption(
  Schema.Struct({ resourceName: Schema.NonEmptyString, resourceGroup: Schema.String, location: Schema.String }),
)

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
      const fs = yield* FSUtil.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const providers = yield* Provider.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const tokens = new Map<string, { access: string; expires: number }>()
      // A resource keeps its Azure Resource Manager ID until it is deleted, so discovery looks it up once.
      const resourceIDs = new Map<string, string>()
      const loading = Semaphore.makeUnsafe(1)
      const discovery = yield* FiberHandle.make<void, never>()
      const loaded: {
        resource?: string
        url?: string
        deployments?: readonly Deployment[]
        connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
      } = {}

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

      const available = Boolean(which("az"))
      const configuredResource = Boolean(resolveResourceName(configured) || typeof configured?.baseURL === "string")
      // Undefined until the Azure CLI answers; a failed lookup leaves the form to manual entry.
      const listing: { resources?: readonly Form.Option[] } = {}

      yield* ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID: Provider.ID.azure,
          method: {
            type: "key",
            label: "API key",
            form: configuredResource
              ? undefined
              : Form.Fields.make([
                  {
                    type: "string",
                    key: "resourceName",
                    title: "Enter Azure Resource Name",
                    placeholder: "e.g. my-models",
                    required: true,
                  },
                ]),
          },
        })
        if (!available) return
        editor.method.update({
          integrationID: Provider.ID.azure,
          method: {
            id: methodID,
            type: "external",
            label: "Microsoft Entra ID (Azure CLI)",
            form: configuredResource
              ? undefined
              : Form.Fields.make([
                  {
                    type: "string",
                    key: "resourceName",
                    title: "Azure resource",
                    placeholder: "e.g. my-models",
                    required: true,
                    pattern: resourcePattern.source,
                    // Resources are listed once at startup, so one created later is typed in. Without a list the field
                    // is a plain text input.
                    ...iife(() => {
                      if (!listing.resources) return { description: "Requests use your `az login` session." }
                      if (listing.resources.length === 0)
                        return {
                          description: "No Azure OpenAI or AI Services resources found for your `az login` account.",
                        }
                      return { custom: true, options: listing.resources }
                    }),
                  },
                ]),
          },
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

      // Resource Graph searches every subscription the Azure CLI account can read, not only the selected one.
      // https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources
      const findResource = Effect.fn("AzurePlugin.findResource")(function* (resource: string) {
        const response = yield* HttpClientRequest.post(
          `${endpoints.management}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`,
        ).pipe(
          HttpClientRequest.schemaBodyJson(ResourceQuery)({ query: resourceQuery(resource) }),
          Effect.flatMap(management),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Resources)),
          Effect.timeout("10 seconds"),
        )
        const id = response.data[0]?.id
        if (!id) return yield* Effect.fail(new Error(`Azure resource "${resource}" was not found`))
        return id
      })

      const managementDeployments = Effect.fn("AzurePlugin.managementDeployments")(function* (resource: string) {
        const key = resource.toLowerCase()
        const id = resourceIDs.get(key) ?? (yield* findResource(resource))
        resourceIDs.set(key, id)
        const origin = new URL(endpoints.management).origin
        return yield* Stream.paginate(`${endpoints.management}${id}/deployments?api-version=2024-10-01`, (url) =>
          management(HttpClientRequest.get(url)).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ManagementDeployments)),
            Effect.timeout("10 seconds"),
            Effect.flatMap((response) =>
              // Every page carries the management token, so a page link must stay on the management endpoint.
              // https://learn.microsoft.com/rest/api/aiservices/accountmanagement/deployments/list
              response.nextLink !== undefined && URL.parse(response.nextLink)?.origin !== origin
                ? Effect.fail(new Error("Azure returned a deployment page outside the management endpoint"))
                : Effect.succeed([
                    response.value.flatMap((raw): Deployment[] => {
                      const item = Option.getOrUndefined(decodeManagementDeployment(raw))
                      return item?.properties.provisioningState === "Succeeded"
                        ? [{ name: item.name, model: item.properties.model.name }]
                        : []
                    }),
                    Option.fromNullishOr(response.nextLink),
                  ] as const),
            ),
          ),
        ).pipe(
          Stream.runCollect,
          // A moved or recreated resource has a new ID, so the next discovery looks it up again.
          Effect.tapError(() => Effect.sync(() => resourceIDs.delete(key))),
        )
      })

      const resourceDeployments = Effect.fn("AzurePlugin.resourceDeployments")(function* (
        url: string,
        credential: Credential.Key | Credential.External,
      ) {
        return yield* http
          .execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
              credential.type === "key"
                ? HttpClientRequest.setHeader("api-key", credential.key)
                : HttpClientRequest.bearerToken((yield* token(cognitiveScope)).access),
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
          )
      })

      // Azure documents the management API as the deployment inventory, but only an Azure CLI session can reach it:
      // Azure Resource Manager accepts Entra ID tokens, never resource keys.
      // https://learn.microsoft.com/rest/api/aiservices/accountmanagement/deployments/list
      // The resource's own inventory serves API keys and identities without Azure Resource Manager read access. Only
      // data-plane version 2022-12-01 has it; later versions dropped `/deployments` and keep `/models`, which lists
      // models the resource can deploy rather than its deployments.
      // https://github.com/Azure/azure-rest-api-specs/blob/main/specification/cognitiveservices/data-plane/OpenAIAuthoring/stable/2022-12-01/azureopenai.json
      const deployments = (url: string, resource: string, credential: Credential.Key | Credential.External) =>
        credential.type === "external"
          ? managementDeployments(resource).pipe(Effect.catch(() => resourceDeployments(url, credential)))
          : resourceDeployments(url, credential)

      // Local and quick, so a switch rebinds the provider before discovery for the new connection calls Azure.
      const rebind = () =>
        loading.withPermit(
          Effect.gen(function* () {
            const current = yield* load()
            if (
              IntegrationConnection.key(current.connection) === IntegrationConnection.key(loaded.connection) &&
              current.resource === loaded.resource
            )
              return
            Object.assign(loaded, current, { url: undefined, deployments: undefined })
            yield* ctx.provider.reload()
          }),
        )

      const discover = Effect.fn("AzurePlugin.discover")(function* () {
        const connection = loaded.connection
        const settings = (yield* providers.get(Provider.ID.azure))?.settings
        const name = loaded.resource ?? resolveResourceName(settings)
        // A custom endpoint may expose other deployments than the resource does, so it keeps the catalog.
        const url =
          connection && name !== undefined && resourcePattern.test(name) && typeof settings?.baseURL !== "string"
            ? `${endpoints.resource(name)}/deployments?api-version=2022-12-01`
            : undefined
        if (loaded.connection !== connection) return
        // Keep the last inventory through transient failures only for the same connection and resource.
        if (loaded.url !== url) {
          loaded.url = url
          if (loaded.deployments) {
            loaded.deployments = undefined
            yield* ctx.model.reload()
          }
        }
        if (!connection || !name || !url) return
        const credential = yield* ctx.integration.connection
          .resolve(connection)
          .pipe(Effect.orElseSucceed(() => undefined))
        if (
          !credential ||
          credential.type === "oauth" ||
          (credential.type === "external" && credential.methodID !== methodID)
        )
          return
        const found = yield* deployments(url, name, credential).pipe(
          // Azure promises no order; normalize it so a reordered response does not rebuild the model list.
          Effect.map((list) => list.toSorted((a, b) => a.name.localeCompare(b.name))),
          Effect.catch((cause) =>
            Effect.logWarning("failed to sync Azure deployments", { cause }).pipe(Effect.as(undefined)),
          ),
        )
        if (!found) return
        if (
          loaded.connection !== connection ||
          IntegrationConnection.key(connection) !==
            IntegrationConnection.key(yield* ctx.integration.connection.active(Provider.ID.azure))
        )
          return
        if (JSON.stringify(found) === JSON.stringify(loaded.deployments)) return
        const catalog = new Map(
          Array.from((yield* providers.snapshot()).records.get(Provider.ID.azure)?.models.keys() ?? [], (id) => [
            id.toLowerCase(),
            id,
          ]),
        )
        const unmatched = found.filter((deployment) => !catalogModel(catalog, deployment))
        if (unmatched.length > 0)
          yield* Effect.logWarning("Azure deployments of models outside the catalog need explicit configuration", {
            deployments: unmatched.map((deployment) => deployment.name),
          })
        loaded.deployments = found
        yield* ctx.model.reload()
      })

      const refresh = () => rebind().pipe(Effect.andThen(FiberHandle.run(discovery, discover())))

      // The connection's resource wins for Azure itself, matching the runtime merge of credentials over settings.
      const resourceFor = (provider: Provider.Info) =>
        provider.id === Provider.ID.azure
          ? (loaded.resource ?? resolveResourceName(provider.settings))
          : resolveResourceName(provider.settings, loaded.resource)

      Object.assign(loaded, yield* load())

      // Lists the resources the Azure CLI account can reach in the background, so the connect form can offer them
      // without startup waiting on Azure. The CLI's profile shows a signed-in account without running the CLI.
      // https://learn.microsoft.com/cli/azure/azure-cli-configuration#cli-configuration-file
      const listResources = Effect.fn("AzurePlugin.listResources")(function* () {
        const profile = yield* fs.readFileStringSafe(
          path.join(process.env.AZURE_CONFIG_DIR ?? path.join(Global.Path.home, ".azure"), "azureProfile.json"),
        )
        // The Azure CLI writes the profile with a byte order mark.
        if (Option.isNone(decodeProfile(profile?.replace(/^\uFEFF/, "")))) return
        const response = yield* HttpClientRequest.post(
          `${endpoints.management}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`,
        ).pipe(
          HttpClientRequest.schemaBodyJson(ResourceQuery)({ query: resourceListQuery, options: { $top: 1000 } }),
          Effect.flatMap(management),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ResourceListing)),
          Effect.timeout("10 seconds"),
        )
        listing.resources = response.data.flatMap((raw): Form.Option[] => {
          const item = Option.getOrUndefined(decodeResourceListing(raw))
          if (!item || !resourcePattern.test(item.resourceName)) return []
          return [
            {
              value: item.resourceName,
              label: item.resourceName,
              description: `${item.resourceGroup} · ${item.location}`,
            },
          ]
        })
        yield* ctx.integration.reload()
      })
      if (available && !configuredResource)
        yield* listResources().pipe(
          Effect.catch((cause) => Effect.logDebug("failed to list Azure resources", { cause })),
          Effect.forkScoped,
        )

      yield* ctx.provider.transform((evt) => {
        for (const item of evt.list()) {
          if (
            item.provider.id !== Provider.ID.azure &&
            !item.provider.package.startsWith("@opencode/ai/providers/azure/")
          )
            continue
          const resourceName = resourceFor(item.provider)
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
        // Bind resource settings and discovery to their account, so a switch hides them until the rebind.
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
          const resourceName = resourceFor(item.provider)
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

      // A switch interrupts discovery for the previous connection instead of waiting for its Azure calls.
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filter((event) => event.data.integrationID === Integration.ID.make("azure")),
        Stream.runForEach(() => refresh()),
        Effect.forkScoped({ startImmediately: true }),
      )
      // Deployments load in the background so startup never waits on Azure; the catalog serves until they arrive.
      // Later changes load when the connection changes, so a new deployment needs a reconnect or restart.
      yield* refresh().pipe(Effect.forkScoped)

      // Entra bearer tokens are minted per request from the target URL's scope, so they are injected
      // at the transport hooks rather than stored as a credential.
      const bearer = Effect.fn("AzurePlugin.bearer")(function* (url: string) {
        const connection = yield* ctx.integration.connection.active(Provider.ID.azure)
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        if (credential?.type !== "external" || credential.methodID !== methodID) return
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

// The Azure CLI method stores the resource as credential metadata, the API key method as its form answer. API keys
// imported from V1 keep their connect-form answer as metadata.
function credentialResource(credential: Credential.Value | undefined) {
  const resource =
    credential?.type === "key"
      ? (credential.configuration?.resourceName ?? credential.metadata?.resourceName)
      : credential?.type === "external" && credential.methodID === methodID
        ? credential.metadata?.resourceName
        : undefined
  return typeof resource === "string" && resource.trim() !== "" ? resource : undefined
}

// Entra ID authentication requires a custom subdomain, which is the resource name every endpoint uses.
// https://learn.microsoft.com/azure/ai-services/cognitive-services-custom-subdomains
const resourceListQuery = [
  "resources",
  "| where type =~ 'microsoft.cognitiveservices/accounts' and kind in~ ('AIServices', 'OpenAI')",
  "| extend resourceName = tostring(properties.customSubDomainName)",
  "| where isnotempty(resourceName)",
  "| project resourceName, resourceGroup, location",
  "| order by resourceName asc",
].join(" ")

function resourceQuery(resource: string) {
  return [
    "resources",
    "| where type =~ 'microsoft.cognitiveservices/accounts' and kind in~ ('AIServices', 'OpenAI')",
    // The custom subdomain is the resource name of every endpoint, and Entra ID authentication requires one.
    // Subdomains are globally unique, so a name matches at most one resource.
    // https://learn.microsoft.com/azure/ai-services/cognitive-services-custom-subdomains
    "| extend resourceName = tostring(properties.customSubDomainName)",
    `| where resourceName =~ '${resource}'`,
    "| project id",
    "| take 1",
  ].join(" ")
}

// A deployment's ID is its name, while limits, costs, and routes come from the catalog model it deploys. Azure compares
// names without case and may return another case, so IDs are lowercase like the catalog's.
// https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
function deployedModels(deployments: readonly Deployment[], catalog: readonly Model.MutableInfo[]) {
  const models = new Map(catalog.map((model) => [model.id.toLowerCase(), model]))
  return new Map(
    deployments.flatMap((deployment) => {
      const model = catalogModel(models, deployment)
      if (!model) return []
      const id = Model.ID.make(deployment.name.toLowerCase())
      const info: Model.MutableInfo = {
        ...structuredClone(model),
        id,
        modelID: Model.ID.make(deployment.name),
        name: id === model.id.toLowerCase() ? model.name : `${model.name} (${deployment.name})`,
      }
      return [[id, info] as const]
    }),
  )
}

// Azure spells some models unlike the catalog: a model name plus a separate version, such as `gpt-4` for GPT-4 Turbo,
// `gpt-35-turbo`, or mixed case such as `DeepSeek-V4-Flash`. A deployment named after a catalog model then stands for
// that model, as it did before discovery; any other is left to explicit configuration.
// https://learn.microsoft.com/azure/foundry/openai/concepts/retired-models
function catalogModel<T>(models: ReadonlyMap<string, T>, deployment: Deployment) {
  return models.get(deployment.model.toLowerCase()) ?? models.get(deployment.name.toLowerCase())
}

function responsesWebSocketCapable(provider: Provider.Info) {
  if (provider.package !== "@opencode/ai/providers/azure/responses") return false
  const settings = provider.settings
  if (settings?.useDeploymentBasedUrls === true) return false
  if (settings?.apiVersion !== undefined && settings.apiVersion !== "v1") return false
  if (typeof settings?.baseURL !== "string") return true
  return /^https:\/\/[^/]+\.openai\.azure\.com(?:\/|$)/i.test(settings.baseURL)
}
