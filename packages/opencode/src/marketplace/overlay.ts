import { isDeepStrictEqual } from "util"
import type {
  MarketplaceHostConfig,
  MarketplaceInstallPlan,
  MarketplaceInstalled,
  MarketplacePluginSpec,
  MarketplaceState,
} from "@opencode-ai/core/marketplace"

export const MARKETPLACE_RUNTIME_CONFIG_KEYS = ["plugin", "skills", "agent", "command", "mcp", "instructions"] as const

type Frame = {
  before: MarketplaceHostConfig
  plan: MarketplaceInstallPlan
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function withoutMarketplace(config: MarketplaceHostConfig) {
  const next = clone(config)
  delete next.marketplace
  return next
}

function activePlan(installed: MarketplaceInstalled): MarketplaceInstallPlan {
  if (installed.active_plan) return installed.active_plan
  if (installed.enabled === false) return {}
  return installed.materialized_plan ?? installed.plan
}

function plans(state: MarketplaceState) {
  return Object.entries(state.installed ?? {})
    .toSorted(
      ([leftKey, left], [rightKey, right]) =>
        (left.priority ?? 0) - (right.priority ?? 0) || leftKey.localeCompare(rightKey),
    )
    .map(([, installed]) => activePlan(installed))
}

function skillPaths(plan: MarketplaceInstallPlan) {
  return Array.from(
    new Set([
      ...(plan.skills?.paths ?? []),
      ...(plan.skills?.items ?? []).flatMap((item) => (item.path ? [item.path] : [])),
    ]),
  )
}

function skillURLs(plan: MarketplaceInstallPlan) {
  return Array.from(
    new Set([
      ...(plan.skills?.urls ?? []),
      ...(plan.skills?.items ?? []).flatMap((item) => (item.url ? [item.url] : [])),
    ]),
  )
}

function pluginIdentity(plugin: MarketplacePluginSpec) {
  const spec = Array.isArray(plugin) ? plugin[0] : plugin
  return spec.match(/^((?:@[^/@\s]+\/)?[^@/:\s]+)(?:@.*)?$/)?.[1] ?? spec
}

function applyArray(current: string[] | undefined, values: string[]) {
  return Array.from(new Set([...(current ?? []), ...values]))
}

function applyPlan(config: MarketplaceHostConfig, plan: MarketplaceInstallPlan) {
  for (const plugin of plan.plugins ?? []) {
    const identity = pluginIdentity(plugin)
    config.plugin = [...(config.plugin ?? []).filter((item) => pluginIdentity(item) !== identity), clone(plugin)]
  }

  const paths = skillPaths(plan)
  const urls = skillURLs(plan)
  if (paths.length || urls.length) {
    config.skills = {
      ...config.skills,
      ...(paths.length ? { paths: applyArray(config.skills?.paths, paths) } : {}),
      ...(urls.length ? { urls: applyArray(config.skills?.urls, urls) } : {}),
    }
  }

  if (plan.agents) config.agent = { ...(config.agent ?? {}), ...clone(plan.agents) }
  if (plan.commands) config.command = { ...(config.command ?? {}), ...clone(plan.commands) }
  if (plan.mcp) config.mcp = { ...(config.mcp ?? {}), ...clone(plan.mcp) }
  if (plan.instructions?.length) config.instructions = applyArray(config.instructions, plan.instructions)
}

function restorePlugins(config: MarketplaceHostConfig, before: MarketplaceHostConfig, plan: MarketplaceInstallPlan) {
  for (const plugin of plan.plugins ?? []) {
    const identity = pluginIdentity(plugin)
    const current = (config.plugin ?? []).filter((item) => pluginIdentity(item) === identity)
    if (!isDeepStrictEqual(current, [plugin])) continue
    const previous = (before.plugin ?? []).filter((item) => pluginIdentity(item) === identity)
    const currentOther = (config.plugin ?? []).filter((item) => pluginIdentity(item) !== identity)
    const previousOther = (before.plugin ?? []).filter((item) => pluginIdentity(item) !== identity)
    config.plugin = isDeepStrictEqual(currentOther, previousOther)
      ? clone(before.plugin ?? [])
      : [...currentOther, ...clone(previous)]
  }
  if (before.plugin === undefined && config.plugin?.length === 0) delete config.plugin
}

function restoreArray(
  config: MarketplaceHostConfig,
  before: MarketplaceHostConfig,
  path: "skills.paths" | "skills.urls" | "instructions",
  values: string[],
) {
  if (!values.length) return
  const read = (target: MarketplaceHostConfig) => {
    if (path === "instructions") return target.instructions
    return target.skills?.[path === "skills.paths" ? "paths" : "urls"]
  }
  const previous = read(before) ?? []
  let current = read(config) ?? []
  for (const value of values) {
    if (previous.includes(value) || !current.includes(value)) continue
    current = current.filter((item) => item !== value)
  }

  if (path === "instructions") {
    if (before.instructions === undefined && current.length === 0) delete config.instructions
    else config.instructions = current
    return
  }

  const key = path === "skills.paths" ? "paths" : "urls"
  const skills = { ...(config.skills ?? {}) }
  if (before.skills?.[key] === undefined && current.length === 0) delete skills[key]
  else skills[key] = current
  if (before.skills === undefined && Object.keys(skills).length === 0) delete config.skills
  else config.skills = skills
}

function restoreObject(
  config: MarketplaceHostConfig,
  before: MarketplaceHostConfig,
  root: "agent" | "command" | "mcp",
  values: Record<string, Record<string, unknown>> | undefined,
) {
  if (!values) return
  const current = { ...(config[root] ?? {}) }
  const previous = before[root] ?? {}
  for (const [key, value] of Object.entries(values)) {
    if (!isDeepStrictEqual(current[key], value)) continue
    if (key in previous) current[key] = clone(previous[key])
    else delete current[key]
  }
  if (before[root] === undefined && Object.keys(current).length === 0) delete config[root]
  else config[root] = current
}

function restorePlan(config: MarketplaceHostConfig, frame: Frame) {
  restorePlugins(config, frame.before, frame.plan)
  restoreArray(config, frame.before, "skills.paths", skillPaths(frame.plan))
  restoreArray(config, frame.before, "skills.urls", skillURLs(frame.plan))
  restoreObject(config, frame.before, "agent", frame.plan.agents)
  restoreObject(config, frame.before, "command", frame.plan.commands)
  restoreObject(config, frame.before, "mcp", frame.plan.mcp)
  restoreArray(config, frame.before, "instructions", frame.plan.instructions ?? [])
}

export function composeMarketplaceConfig(base: MarketplaceHostConfig, state: MarketplaceState) {
  const next = withoutMarketplace(base)
  for (const plan of plans(state)) applyPlan(next, plan)
  next.marketplace = clone(state)
  return next
}

export function decomposeMarketplaceConfig(
  effective: MarketplaceHostConfig,
  base: MarketplaceHostConfig,
  state: MarketplaceState,
) {
  const frames: Frame[] = []
  const cursor = withoutMarketplace(base)
  for (const plan of plans(state)) {
    const before = clone(cursor)
    applyPlan(cursor, plan)
    frames.push({ before, plan })
  }

  const next = withoutMarketplace(effective)
  for (const frame of frames.toReversed()) restorePlan(next, frame)
  return next
}
