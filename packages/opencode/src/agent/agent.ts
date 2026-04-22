import { Config } from "../config"
import z from "zod"
import { Provider } from "../provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Instance } from "../project/instance"
import { Truncate } from "../tool"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import BUG_REPORT_PROMPT from "./prompt/bug-report.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { makeRuntime } from "@/effect/run-service"
import { Effect, Exit, Context, Layer } from "effect"
import { InstanceState } from "@/effect"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { loadAgents, agentPermissionDefaults } from "./load"
import { from } from "./permission"

export const Info = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    native: z.boolean().optional(),
    hidden: z.boolean().optional(),
    topP: z.number().optional(),
    temperature: z.number().optional(),
    color: z.string().optional(),
    permission: Permission.Ruleset.zod,
    model: z
      .object({
        modelID: ModelID.zod,
        providerID: ProviderID.zod,
      })
      .optional(),
    variant: z.string().optional(),
    prompt: z.string().optional(),
    options: z.record(z.string(), z.any()),
    steps: z.number().int().positive().optional(),
  })
  .meta({
    ref: "Agent",
  })
export type Info = z.infer<typeof Info>

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }>
}

type State = Omit<Interface, "generate">
type AgentOverride = NonNullable<Config.Info["agent"]>[string]

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

function withBugReportPrompt(agent: Info) {
  const bugReportAllowed = Permission.evaluate("bug_report", "*", agent.permission).action === "allow"
  if (!agent.prompt || !bugReportAllowed || agent.prompt.includes(BUG_REPORT_PROMPT)) return agent
  return {
    ...agent,
    prompt: `${agent.prompt}\n\n${BUG_REPORT_PROMPT}`,
  }
}

const legacyAgentTargets = {
  build: "ayaz",
  general: "quick-high",
  plan: "niggli",
  explore: "explorer",
} as const satisfies Record<string, string>

function applyAgentOverride(item: Info, value: AgentOverride) {
  const next = {
    ...item,
    model: value.model ? Provider.parseModel(value.model) : item.model,
    variant: value.variant ?? item.variant,
    prompt: value.prompt ?? item.prompt,
    description: value.description ?? item.description,
    temperature: value.temperature ?? item.temperature,
    topP: value.top_p ?? item.topP,
    mode: value.mode ?? item.mode,
    color: value.color ?? item.color,
    hidden: value.hidden ?? item.hidden,
    name: value.name ?? item.name,
    steps: value.steps ?? item.steps,
    options: mergeDeep(item.options, value.options ?? {}),
  }
  return {
    ...next,
    permission: Permission.merge(next.permission, from(value.permission ?? {})),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (_ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const base = path.join(Global.Path.config, "*")
        const whitelistedDirs = [Truncate.GLOB, ...skillDirs.map((dir) => path.join(dir, "*"))]

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          ...agentPermissionDefaults(),
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          inspect: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
          search: "allow",
          discover_batch: "allow",
        })

        const user = from(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        Object.assign(agents, loadAgents({ defaults, user }))
        const legacyOverrides: Partial<Record<keyof typeof legacyAgentTargets, AgentOverride>> = {}

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (key in legacyAgentTargets) {
            legacyOverrides[key as keyof typeof legacyAgentTargets] = value
            continue
          }
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          agents[key] = applyAgentOverride(item, value)
        }

        // Ensure common external directories stay available unless explicitly denied.
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (!explicit) {
            agents[name].permission = Permission.merge(
              agents[name].permission,
              Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
            )
          }

          const baseDeny = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === base
          })
          if (!baseDeny) {
            agents[name].permission = Permission.merge(
              agents[name].permission,
              Permission.fromConfig({ external_directory: { [base]: "allow" } }),
            )
          }

          agents[name] = withBugReportPrompt(agents[name])
        }

        const legacy = Object.fromEntries(
          Object.entries(legacyAgentTargets).flatMap(([name, target]) => {
            const baseAgent = agents[target]
            if (!baseAgent) return []
            const override = legacyOverrides[name as keyof typeof legacyAgentTargets]
            if (override?.disable) return []
            const permission =
              name === "plan"
                ? Permission.merge(
                    baseAgent.permission,
                    Permission.fromConfig({
                      question: "allow",
                      plan_exit: "allow",
                      external_directory: {
                        [path.join(Global.Path.data, "plans", "*")]: "allow",
                      },
                      edit: {
                        "*": "deny",
                        [path.join(".opencode", "plans", "*.md")]: "allow",
                        [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                      },
                    }),
                  )
                : baseAgent.permission
            const alias = withBugReportPrompt(
              applyAgentOverride(
                {
                  ...baseAgent,
                  name,
                  mode: name === "plan" ? "primary" : baseAgent.mode,
                  native: true,
                  options: mergeDeep({}, baseAgent.options),
                  permission: permission.map((rule) => ({ ...rule })),
                },
                override ?? {},
              ),
            )
            return [[name, alias] as const]
          }),
        ) satisfies Record<string, Info>

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[agent] ?? legacy[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "atlas"), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent] ?? legacy[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent.name
          }
          const pick = (items: Info[]) => items.find((item) => item.mode !== "subagent" && item.hidden !== true)
          const visible =
            pick([agents.atlas].filter(Boolean)) ||
            pick(Object.values(agents).filter((item) => item.name !== "atlas" && item.name !== "ayaz")) ||
            pick([agents.ayaz].filter(Boolean))
          if (!visible) throw new Error("no primary visible agent found")
          return visible.name
        })

        return {
          get,
          list,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        const item = yield* InstanceState.useEffect(state, (s) => s.get(agent))
        if (!item?.model) return item
        const exit = yield* provider.getModel(item.model.providerID, item.model.modelID).pipe(Effect.exit)
        if (Exit.isSuccess(exit)) return item
        return { ...item, model: undefined }
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: z.object({
            identifier: z.string(),
            whenToUse: z.string(),
            systemPrompt: z.string(),
          }),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

const runtime = makeRuntime(Service, defaultLayer)

export const get = (name: string) => runtime.runPromise((svc) => svc.get(name))
export const list = () => runtime.runPromise((svc) => svc.list())
export const defaultAgent = () => runtime.runPromise((svc) => svc.defaultAgent())
export const generate = (input: { description: string; model?: { providerID: ProviderID; modelID: ModelID } }) =>
  runtime.runPromise((svc) => svc.generate(input))

export * as Agent from "./agent"
