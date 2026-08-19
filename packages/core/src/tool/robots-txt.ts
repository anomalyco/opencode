import { Duration, Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

interface Rule {
  type: "allow" | "disallow"
  pattern: string
}

interface Group {
  agents: string[]
  rules: Rule[]
  disallowAiTraining: string[]
  disallowAiInput: string[]
  contentUsageBlockAi: boolean
  contentSignalAiInput: boolean
  contentSignalAiTrain: boolean
}

type RobotsRules = Group[]

let cache = new Map<string, { rules: RobotsRules; expiresAt: number }>()

export function clearCache() {
  cache = new Map<string, { rules: RobotsRules; expiresAt: number }>()
}

const CACHE_TTL_MINUTES = 45

function originFrom(url: string): string | undefined {
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`
  } catch {
    return undefined
  }
}

function pathMatch(pattern: string, path: string): boolean {
  pattern = pattern.trim()
  if (pattern === "/") return true
  const hasEnd = pattern.endsWith("$")
  const pat = hasEnd ? pattern.slice(0, -1) : pattern
  if (pat === "") return true
  const parts = pat.split("*")
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === "") continue
    if (i === 0 && !path.startsWith(part)) return false
    const idx = path.indexOf(part, i === 0 ? 0 : pos)
    if (idx === -1) return false
    pos = idx + part.length
  }
  if (hasEnd) {
    if (parts[parts.length - 1] !== "") return pos === path.length
    return true
  }
  return true
}

function findMatchingGroup(groups: RobotsRules, userAgent: string): Group | undefined {
  let exactMatch: Group | undefined
  let wildcardMatch: Group | undefined
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent.toLowerCase() === userAgent.toLowerCase()) {
        exactMatch = group
      } else if (agent.toLowerCase() === "*") {
        wildcardMatch = group
      }
    }
  }
  return exactMatch ?? wildcardMatch
}

function isPathAllowed(path: string, group: Group): boolean {
  let bestRule: Rule | undefined
  for (const rule of group.rules) {
    if (pathMatch(rule.pattern, path)) {
      if (!bestRule || rule.pattern.length > bestRule.pattern.length) {
        bestRule = rule
      } else if (rule.pattern.length === bestRule.pattern.length && rule.type === "allow" && bestRule.type === "disallow") {
        bestRule = rule
      }
    }
  }
  if (!bestRule) return true
  return bestRule.type === "allow"
}

export function parseRobotsTxt(text: string): RobotsRules {
  const groups: Group[] = []
  let currentGroup: Group | undefined

  const agents: string[] = []

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) {
      if (trimmed === "") {
        if (currentGroup && agents.length > 0) {
          currentGroup.agents = [...agents]
          groups.push(currentGroup)
        }
        currentGroup = undefined
        agents.length = 0
      }
      continue
    }
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const field = trimmed.slice(0, colonIdx).trim().toLowerCase()
    const value = trimmed.slice(colonIdx + 1).trim()
    if (value === "") continue
    if (field === "user-agent") {
      if (currentGroup && currentGroup.rules.length > 0) {
        currentGroup.agents = [...agents]
        groups.push(currentGroup)
        agents.length = 0
        currentGroup = { agents: [], rules: [], disallowAiTraining: [], disallowAiInput: [], contentUsageBlockAi: false, contentSignalAiInput: false, contentSignalAiTrain: false }
      } else if (!currentGroup) {
        currentGroup = { agents: [], rules: [], disallowAiTraining: [], disallowAiInput: [], contentUsageBlockAi: false, contentSignalAiInput: false, contentSignalAiTrain: false }
      }
      agents.push(value)
    } else if (field === "disallow" && currentGroup) {
      currentGroup.rules.push({ type: "disallow", pattern: value })
    } else if (field === "allow" && currentGroup) {
      currentGroup.rules.push({ type: "allow", pattern: value })
    } else if (field === "disallowaitraining" && currentGroup) {
      currentGroup.disallowAiTraining.push(value)
    } else if (field === "disallowaiinput" && currentGroup) {
      currentGroup.disallowAiInput.push(value)
    } else if (field === "content-usage" && currentGroup) {
      if (value.toLowerCase().trim() === "ai=n") currentGroup.contentUsageBlockAi = true
    } else if (field === "content-signal" && currentGroup) {
      for (const part of value.split(",")) {
        const trimmed = part.trim().toLowerCase()
        if (trimmed === "ai-train=no") currentGroup.contentSignalAiTrain = true
        else if (trimmed === "ai-input=no") currentGroup.contentSignalAiInput = true
      }
    }
  }
  if (currentGroup && agents.length > 0) {
    currentGroup.agents = [...agents]
    groups.push(currentGroup)
  }
  return groups
}

export function isAllowed(path: string, groups: RobotsRules, userAgent: string): boolean {
  if (groups.length === 0) return true
  const group = findMatchingGroup(groups, userAgent)
  if (!group) return true
  return isPathAllowed(path, group)
}

export function checkAiOptOut(groups: RobotsRules, path: string, inputMeansTraining: boolean, userAgent: string): boolean {
  const group = findMatchingGroup(groups, userAgent)
  if (!group) return false
  for (const p of group.disallowAiInput) {
    if (pathMatch(p, path)) return true
  }
  if (group.contentSignalAiInput) return true
  if (inputMeansTraining) {
    for (const p of group.disallowAiTraining) {
      if (pathMatch(p, path)) return true
    }
    if (group.contentUsageBlockAi) return true
    if (group.contentSignalAiTrain) return true
  }
  return false
}

export const fetchRobotsTxt = (http: HttpClient.HttpClient, url: string, userAgent: string) =>
  Effect.gen(function* () {
    if (cache.size > 500) {
      const now = Date.now()
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key)
      }
    }
    const origin = originFrom(url)
    if (!origin) return undefined
    const cached = cache.get(origin)
    if (cached && cached.expiresAt > Date.now()) return cached.rules
    const robotsUrl = `${origin}/robots.txt`
    const response = yield* http
      .execute(
        HttpClientRequest.get(robotsUrl).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": userAgent,
            Accept: "text/plain",
          }),
        ),
      )
      .pipe(
        Effect.catch(() => Effect.succeed(undefined as HttpClientResponse.HttpClientResponse | undefined)),
        Effect.timeoutOrElse({
          duration: Duration.seconds(10),
          orElse: () => Effect.succeed(undefined),
        }),
      )
    if (!response) return undefined
    if (response.status !== 200) return undefined
    const text = yield* response.text.pipe(
      Effect.catch(() => Effect.succeed("")),
    )
    const rules = parseRobotsTxt(text)
    cache.set(origin, { rules, expiresAt: Date.now() + CACHE_TTL_MINUTES * 60 * 1000 })
    return rules
  })
