export * as ConfigAgentPlugin from "./agent"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect, Option, Schema } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { ConfigAgent } from "../agent"
import { ConfigMarkdown } from "../markdown"
import { FSUtil } from "../../fs-util"
import { ModelV2 } from "../../model"
import { ConfigAgentV1 } from "../../v1/config/agent"
import { ConfigMigrateV1 } from "../../v1/config/migrate"
import { Global } from "../../global"
import { PermissionV2 } from "../../permission"
import type { LocationMutation } from "../../location-mutation"
import type { ReadTool } from "../../tool/read"
import type { EditTool } from "../../tool/edit"

const legacySources = [
  { pattern: "{agent,agents}/**/*.md", primary: false },
  { pattern: "{mode,modes}/*.md", primary: true },
] as const
const decodeAgent = Schema.decodeUnknownOption(ConfigAgent.Info)
const decodeLegacyAgent = Schema.decodeUnknownOption(ConfigAgentV1.Info)
const decodeConfig = Schema.decodeUnknownOption(Config.Info)
type PathAction =
  | LocationMutation.ExternalDirectoryAuthorization["action"]
  | typeof ReadTool.name
  | typeof EditTool.name
const pathActions = ["external_directory", "read", "edit"] as const satisfies readonly PathAction[]
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

export const Plugin = define({
  id: "config-agent",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    yield* ctx.agent.transform(
      Effect.fn(function* (draft) {
        const documents = yield* Effect.forEach(yield* config.entries(), (entry) => {
          if (entry.type === "document") return Effect.succeed([entry])
          return Effect.gen(function* () {
            const files = yield* discover(fs, entry.path)
            return yield* Effect.forEach(files, (file) =>
              fs.readFileStringSafe(file.filepath).pipe(
                Effect.map((content) => content && decode(file, content)),
                Effect.catch(() => Effect.succeed(undefined)),
              ),
            ).pipe(
              Effect.map((documents) =>
                documents.filter((document): document is Config.Document => document !== undefined),
              ),
            )
          })
        }).pipe(Effect.map((documents) => documents.flat()))
        const permissions = expandPermissions(
          documents.flatMap((document) => document.info.permissions ?? []),
          global.home,
        )
        const configuredDefault = Config.latest(documents, "default_agent")
        if (configuredDefault !== undefined) draft.default(AgentV2.ID.make(configuredDefault))
        for (const current of draft.list()) {
          draft.update(current.id, (agent) => agent.permissions.push(...permissions))
        }

        for (const document of documents) {
          for (const [id, item] of Object.entries(document.info.agents ?? {})) {
            const agentID = AgentV2.ID.make(id)
            if (item.disabled) {
              draft.remove(agentID)
              continue
            }

            const exists = draft.get(agentID) !== undefined
            draft.update(agentID, (agent) => {
              if (!exists) agent.permissions.push(...permissions)
              if (item.model !== undefined) {
                const model = ModelV2.parse(item.model)
                agent.model = { id: model.modelID, providerID: model.providerID, variant: agent.model?.variant }
              }
              if (item.variant !== undefined && agent.model !== undefined) {
                agent.model.variant = ModelV2.VariantID.make(item.variant)
              }
              if (item.request !== undefined) {
                Object.assign(agent.request.headers, item.request.headers ?? {})
                Object.assign(agent.request.body, item.request.body ?? {})
              }
              if (item.system !== undefined) agent.system = item.system
              if (item.description !== undefined) agent.description = item.description
              if (item.mode !== undefined) agent.mode = item.mode
              if (item.hidden !== undefined) agent.hidden = item.hidden
              if (item.color !== undefined) agent.color = item.color
              if (item.steps !== undefined) agent.steps = item.steps
              if (item.permissions !== undefined) {
                agent.permissions.push(...expandPermissions(item.permissions, global.home))
              }
            })
          }
        }
      }),
    )
  }),
})

function expandPermissions(rules: PermissionV2.Ruleset, home: string): PermissionV2.Ruleset {
  // Expand only resources tools resolve as filesystem paths. Bash resources are raw shell text:
  // rewriting `$HOME/private/**` would miss `$HOME/private/key`, and safe expansion needs shell-aware parsing.
  return rules.map((rule) =>
    isPathAction(rule.action) ? { ...rule, resource: expandHome(rule.resource, home) } : rule,
  )
}

function isPathAction(action: string): action is PathAction {
  return pathActions.some((item) => item === action)
}

function expandHome(resource: string, home: string) {
  if (resource.startsWith("~/")) return home + resource.slice(1)
  if (resource === "~") return home
  if (resource === "$HOME") return home
  if (resource.startsWith("$HOME/")) return home + resource.slice(5)
  if (resource.startsWith("$HOME\\")) return home + resource.slice(5)
  return resource
}

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

function decode(file: { directory: string; filepath: string; primary: boolean }, content: string) {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const name = path
    .relative(file.directory, file.filepath)
    .replaceAll("\\", "/")
    .replace(/^(agent|agents|mode|modes)\//, "")
    .replace(/\.md$/, "")
  const body = markdown.content.trim()
  const legacy = Object.keys(markdown.data).some((key) => !agentKeys.has(key))
  const agent = Option.getOrUndefined(
    legacy
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
