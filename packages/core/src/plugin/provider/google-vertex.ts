import { Effect, Option, Schema, Stream } from "effect"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Provider } from "../../provider.js"
import { configuredSettings } from "./configured.js"

const ADC_METHOD = "google-adc"

const decodeADCFile = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ quota_project_id: Schema.optional(Schema.String) })),
)

function resolveProject(options: Readonly<Record<string, unknown>>) {
  // models.dev advertises GOOGLE_VERTEX_PROJECT for Vertex, while Google SDKs
  // and ADC examples commonly use the broader Google Cloud project aliases.
  const project =
    options.project ??
    process.env.GOOGLE_VERTEX_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    process.env.GCLOUD_PROJECT
  return typeof project === "string" ? project : undefined
}

function resolveLocation(options: Readonly<Record<string, unknown>>) {
  const location =
    options.location ??
    process.env.GOOGLE_VERTEX_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.VERTEX_LOCATION
  return typeof location === "string" ? location : undefined
}

function vertexEndpoint(location: string) {
  if (location === "global") return "aiplatform.googleapis.com"
  return `${location}-aiplatform.googleapis.com`
}

function replaceVertexVars(value: string, project: string | undefined, location: string) {
  // Vertex OpenAI-compatible endpoints are stored as templates in the catalog;
  // expand them after provider config/env project and location have been resolved.
  return value
    .replaceAll("${GOOGLE_VERTEX_PROJECT}", project ?? "${GOOGLE_VERTEX_PROJECT}")
    .replaceAll("${GOOGLE_VERTEX_LOCATION}", location)
    .replaceAll("${GOOGLE_VERTEX_ENDPOINT}", vertexEndpoint(location))
}

export const GoogleVertexPlugin = define({
  id: "opencode.provider.google.vertex",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const bus = yield* Bus.Service
    const read = (file: string) => fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
    // Same lookup as gcloud itself. Only project IDs are read; nothing here contacts Google.
    const gcloud =
      process.env.CLOUDSDK_CONFIG ??
      (process.platform === "win32" && process.env.APPDATA
        ? path.join(process.env.APPDATA, "gcloud")
        : path.join(Global.Path.home, ".config", "gcloud"))
    const active = `config_${(yield* read(path.join(gcloud, "active_config")))?.trim() || "default"}`
    const configs = (yield* fs
      .readDirectory(path.join(gcloud, "configurations"))
      .pipe(Effect.orElseSucceed((): string[] => [])))
      .filter((name) => name.startsWith("config_"))
      .toSorted((a, b) => Number(b === active) - Number(a === active) || a.localeCompare(b))
    const contents = yield* Effect.forEach(configs, (name) => read(path.join(gcloud, "configurations", name)))
    const adcFile = yield* read(path.join(gcloud, "application_default_credentials.json"))
    const configured = (yield* configuredSettings(Provider.ID.googleVertex)) ?? {}
    const projects = Array.from(
      new Set(
        [
          resolveProject(configured),
          ...contents.map((content) => content?.match(/^project\s*=\s*(\S+)/m)?.[1]),
          Option.getOrUndefined(decodeADCFile(adcFile ?? ""))?.quota_project_id,
        ].filter((project): project is string => Boolean(project)),
      ),
    )
    // Credentials work in every location; locations differ in which models they serve. `global` serves the most.
    const locations = Array.from(
      new Set([
        resolveLocation(configured) ?? "global",
        "global",
        "us",
        "eu",
        ...contents.flatMap((content) =>
          Array.from((content ?? "").matchAll(/^region\s*=\s*(\S+)/gm), (match) => match[1]),
        ),
      ]),
    )

    const load = Effect.fn("GoogleVertexPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(Provider.ID.googleVertex)
      // Reads the stored value rather than resolving the connection, so startup never refreshes anything.
      const stored =
        connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
      if (stored?.value.type !== "external" || stored.value.methodID !== ADC_METHOD) return {}
      return { project: stored.value.metadata?.project, location: stored.value.metadata?.location }
    })
    const selected = { settings: yield* load() }
    const settingsFor = (provider: {
      readonly id: string
      readonly integrationID?: string
      readonly settings?: Readonly<Record<string, unknown>>
    }) => ({
      ...provider.settings,
      ...((provider.integrationID ?? provider.id) === Provider.ID.googleVertex ? selected.settings : {}),
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: Provider.ID.googleVertex,
        method: {
          id: ADC_METHOD,
          type: "external",
          label: "Google Cloud credentials (gcloud auth or environment)",
          form: [
            {
              key: "project",
              type: "string",
              title: "Google Cloud project",
              description: projects.length
                ? `Found ${projects.length} project${projects.length === 1 ? "" : "s"} in your gcloud configuration.`
                : "No projects found in your gcloud configuration.",
              required: true,
              minLength: 1,
              pattern: "\\S",
              placeholder: "Project ID",
              custom: true,
              default: projects[0],
              options: projects.map((project) => ({ value: project, label: project })),
            },
            {
              key: "location",
              type: "string",
              title: "Location",
              description:
                "global serves the most models. Use us, eu, or a single region for data residency or regional quota.",
              required: true,
              minLength: 1,
              pattern: "\\S",
              placeholder: "Location",
              custom: true,
              default: locations[0],
              options: locations.map((location) => ({ value: location, label: location })),
            },
          ],
        },
      })
    })
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (
          !item.provider.package.startsWith("@opencode/ai/providers/google-vertex") &&
          !(
            item.provider.id === Provider.ID.googleVertex &&
            item.provider.package === "@opencode/ai/providers/openai-compatible"
          )
        )
          continue
        const settings = settingsFor(item.provider)
        const project = resolveProject(settings)
        const location = resolveLocation(settings) ?? "global"
        evt.update(item.provider.id, (provider) => {
          // Vertex authenticates through ADC rather than a key credential, so a
          // resolvable project is what makes the provider usable.
          if (project && provider.activation === "auto") provider.activation = "enabled"
          provider.settings = {
            ...settingsFor(provider),
            ...(project ? { project } : {}),
            location,
            ...(typeof provider.settings?.baseURL === "string"
              ? { baseURL: replaceVertexVars(provider.settings.baseURL, project, location) }
              : {}),
          }
        })
      }
    })
    yield* ctx.model.transform((models) => {
      for (const item of models.provider.list()) {
        if (
          !item.provider.package.startsWith("@opencode/ai/providers/google-vertex") &&
          !(
            item.provider.id === Provider.ID.googleVertex &&
            item.provider.package === "@opencode/ai/providers/openai-compatible"
          )
        )
          continue
        const settings = settingsFor(item.provider)
        const project = resolveProject(settings)
        const location = resolveLocation(settings) ?? "global"
        for (const model of models.list(item.provider.id)) {
          if (typeof model.settings?.baseURL !== "string") continue
          models.update(item.provider.id, model.id, (draft) => {
            draft.settings = {
              ...draft.settings,
              baseURL: replaceVertexVars(String(draft.settings?.baseURL), project, location),
            }
          })
        }
      }
    })
    yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          const next = yield* load()
          if (JSON.stringify(next) === JSON.stringify(selected.settings)) return
          selected.settings = next
          yield* ctx.provider.reload()
          yield* ctx.model.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
