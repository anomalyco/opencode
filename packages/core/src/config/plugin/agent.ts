export * as ConfigAgentPlugin from "./agent"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { ConfigAgent } from "../agent"
import { ConfigMarkdown } from "../markdown"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ConfigAgentV1 } from "../../v1/config/agent"
import { ConfigMigrateV1 } from "../../v1/config/migrate"

const legacySources = [
  { pattern: "{agent,agents}/**/*.md", primary: false },
  { pattern: "{mode,modes}/*.md", primary: true },
] as const
const decodeAgent = Schema.decodeUnknownOption(ConfigAgent.Info)
const decodeLegacyAgent = Schema.decodeUnknownOption(ConfigAgentV1.Info)
const decodeConfig = Schema.decodeUnknownOption(Config.Info)
const agentKeys = new Set([
  "model",
  "variant",
  "request",
  "system",
  "description",
  "mode",
  "hidden",
  "color",
  "steps",
  "disabled",
  "permissions",
])

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("config-agent"),
  effect: Effect.gen(function* () {
    const agent = yield* AgentV2.Service
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const entries = yield* config.entries()
    const documents = yield* Effect.forEach(entries, (entry) => {
      if (entry.type === "document") return Effect.succeed([entry])
      return Effect.gen(function* () {
        const files = yield* discover(fs, entry.path)
        return yield* Effect.forEach(files, (file) => readAndDecode(fs, file)).pipe(
          Effect.map(filterDocuments),
        )
      })
    }).pipe(Effect.map((documentGroups) => documentGroups.flat()))

    const customPaths = entries.flatMap((entry) => {
      if (entry.type !== "document") return []
      const pathsValue = entry.info.agents?.paths
      return Array.isArray(pathsValue) ? pathsValue : []
    })

    const customDocuments = yield* Effect.gen(function* () {
      const maybeGlobal = yield* Effect.serviceOption(Global.Service)
      const maybeLocation = yield* Effect.serviceOption(Location.Service)
      if (Option.isNone(maybeGlobal) || Option.isNone(maybeLocation)) return []
      const globalService = maybeGlobal.value
      const locationService = maybeLocation.value
      return yield* Effect.forEach(customPaths, (item) => {
        const expanded = item.startsWith("~/") ? path.join(globalService.home, item.slice(2)) : item
        const resolved = path.isAbsolute(expanded) ? expanded : path.join(locationService.directory, expanded)
        return discoverFlat(fs, resolved).pipe(
          Effect.flatMap((files) =>
            Effect.forEach(files, (file) => readAndDecode(fs, file)).pipe(
              Effect.map(filterDocuments),
            ),
          ),
        )
      }).pipe(Effect.map((documentGroups) => documentGroups.flat()))
    })

    const allDocuments = [...documents, ...customDocuments]

    yield* agent.update((editor) => {
      const globalPermissions = allDocuments.flatMap((document) => document.info.permissions ?? [])
      const configuredDefault = Config.latest(allDocuments, "default_agent")
      if (configuredDefault !== undefined) editor.default(AgentV2.ID.make(configuredDefault))
      for (const current of editor.list()) {
        editor.update(current.id, (agent) => agent.permissions.push(...globalPermissions))
      }

      for (const document of allDocuments) {
        const agentEntries = Object.entries(document.info.agents ?? {}).filter(
          (entry): entry is [string, ConfigAgent.Info] => !Array.isArray(entry[1]),
        )
        for (const [id, agentConfig] of agentEntries) {
          const agentID = AgentV2.ID.make(id)
          if (agentConfig.disabled) {
            editor.remove(agentID)
            continue
          }

          const exists = editor.get(agentID) !== undefined
          editor.update(agentID, (agent) => {
            if (!exists) agent.permissions.push(...globalPermissions)
            if (agentConfig.model !== undefined) {
              const model = ModelV2.parse(agentConfig.model)
              agent.model = { id: model.modelID, providerID: model.providerID, variant: agent.model?.variant }
            }
            if (agentConfig.variant !== undefined && agent.model !== undefined) {
              agent.model.variant = ModelV2.VariantID.make(agentConfig.variant)
            }
            if (agentConfig.request !== undefined) {
              Object.assign(agent.request.headers, agentConfig.request.headers ?? {})
              Object.assign(agent.request.body, agentConfig.request.body ?? {})
            }
            if (agentConfig.system !== undefined) agent.system = agentConfig.system
            if (agentConfig.description !== undefined) agent.description = agentConfig.description
            if (agentConfig.mode !== undefined) agent.mode = agentConfig.mode
            if (agentConfig.hidden !== undefined) agent.hidden = agentConfig.hidden
            if (agentConfig.color !== undefined) agent.color = agentConfig.color
            if (agentConfig.steps !== undefined) agent.steps = agentConfig.steps
            if (agentConfig.permissions !== undefined) agent.permissions.push(...agentConfig.permissions)
          })
        }
      }
    })
  }),
})

function discover(fs: FSUtil.Interface, directory: string) {
  return Effect.forEach(legacySources, (source) =>
    fs
      .glob(source.pattern, { cwd: directory, absolute: true, dot: true, symlink: true })
      .pipe(
        Effect.map((files) => files.toSorted().map((filepath) => ({ directory, filepath, primary: source.primary }))),
      ),
  ).pipe(
    Effect.map((files) => files.flat()),
    Effect.catch(() => Effect.succeed([])),
  )
}

function discoverFlat(fs: FSUtil.Interface, directory: string) {
  return fs.glob("*.md", { cwd: directory, absolute: true, dot: true }).pipe(
    Effect.map((files) => files.toSorted().map((filepath) => ({ directory, filepath, primary: false }))),
    Effect.catch(() => Effect.succeed([])),
  )
}

function readAndDecode(fs: FSUtil.Interface, file: { directory: string; filepath: string; primary: boolean }) {
  return fs.readFileStringSafe(file.filepath).pipe(
    Effect.map((content): Config.Document | undefined => content ? decode(file, content) : undefined),
    Effect.catch(() => Effect.succeed(undefined as Config.Document | undefined)),
  )
}

function filterDocuments(documents: (Config.Document | undefined)[]) {
  return documents.filter((document): document is Config.Document => document !== undefined)
}

function decode(file: { directory: string; filepath: string; primary: boolean }, content: string) {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const name = path
    .relative(file.directory, file.filepath)
    .replaceAll("\\", "/")
    .replace(/^(agent|agents|mode|modes)\//, "")
    .replace(/\.md$/, "")
  const body = markdown.content.trim()
  const hasLegacyKeys = Object.keys(markdown.data).some((key) => !agentKeys.has(key))
  const agent = Option.getOrUndefined(
    hasLegacyKeys
      ? Option.map(
          decodeLegacyAgent({ name, ...markdown.data, prompt: body }, { errors: "all", propertyOrder: "original" }),
          ConfigMigrateV1.migrateAgent,
        )
      : decodeAgent({ ...markdown.data, system: body }, { errors: "all", propertyOrder: "original" }),
  )
  if (!agent) return
  const info = Option.getOrUndefined(
    decodeConfig({
      agents: { [name]: file.primary ? { ...agent, mode: "primary" } : agent },
    }),
  )
  if (!info) return
  return new Config.Document({ type: "document", path: file.filepath, info })
}
