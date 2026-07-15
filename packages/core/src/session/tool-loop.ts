export * as ToolLoop from "./tool-loop"

export const THRESHOLD = 3

export type Outcome =
  | {
      readonly type: "success"
      readonly values: ReadonlyArray<unknown>
      readonly files?: number
    }
  | {
      readonly type: "error"
      readonly message: string
    }

export type Observation =
  | { readonly type: "reset" }
  | {
      readonly type: "tool"
      readonly tool: string
      readonly outcome: Outcome
    }

export type Detection = {
  readonly tool: string
  readonly count: number
  readonly outcome: "empty" | "error"
}

export const REF = "tool_loop_no_progress"

const discoveryTool = (tool: string) => {
  const words = tool
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  return words.some((word) =>
    ["discover", "find", "glob", "grep", "list", "lookup", "query", "scan", "search", "websearch"].includes(word),
  )
}

const noMatch = (value: string) => {
  const text = value.trim().toLowerCase()
  if (text === "") return true
  if (/^not found[.!]?$/.test(text)) return true
  if (/^0\s+(?:results?|resources?|items?|matches?|tools?)\b/.test(text)) return true
  if (/^no\s+(?:matching\s+)?(?:results?|resources?|items?|matches?|tools?)[.!]?$/.test(text)) return true
  if (/\bno\b.*\b(?:results?|resources?|items?|matches?|tools?)\b.*\b(?:found|available|returned|matched)\b/.test(text))
    return true
  if (/\b(?:results?|resources?|items?|matches?|tools?)\b.*\bnot found\b/.test(text)) return true
  return false
}

const isEmpty = (value: unknown, key?: string): boolean => {
  if (value === undefined || value === null) return true
  if (typeof value === "string") {
    if (noMatch(value)) return true
    const text = value.trim()
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
      try {
        return isEmpty(JSON.parse(text), key)
      } catch {
        return false
      }
    }
    return false
  }
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "number") return value === 0 && /^(?:count|total|size)$/i.test(key ?? "")
  if (typeof value === "boolean") {
    if (/^(?:ok|success)$/i.test(key ?? "")) return value
    if (/^(?:hasMore|truncated)$/i.test(key ?? "")) return !value
    return false
  }
  if (typeof value !== "object") return false

  const entries = Object.entries(value)
  if (entries.length === 0) return true
  return entries.every(([name, item]) => {
    if (/^(?:filter|input|limit|offset|page|prefix|query|search|server)$/i.test(name)) return true
    if (name === "status" && typeof item === "string") return /^(?:empty|ok|success|no[_ -]?results?)$/i.test(item)
    return isEmpty(item, name)
  })
}

const fingerprint = (tool: string, outcome: Outcome): string | undefined => {
  if (outcome.type === "error") {
    const message = outcome.message.trim()
    return message === "" ? undefined : `error:${message}`
  }
  // An empty payload does not prove that a mutation made no progress. Restrict
  // successful empty-result detection to discovery-shaped tools; repeated
  // failures remain eligible for every tool because the operation did not succeed.
  if (!discoveryTool(tool)) return undefined
  if ((outcome.files ?? 0) > 0) return undefined
  return outcome.values.every((value) => isEmpty(value)) ? "empty" : undefined
}

export function detect(observations: ReadonlyArray<Observation>, threshold = THRESHOLD): Detection | undefined {
  if (!Number.isInteger(threshold) || threshold < 1) throw new Error("Tool loop threshold must be a positive integer")

  let streak: Array<{ readonly tool: string; readonly fingerprint: string }> = []
  for (const observation of observations) {
    if (observation.type === "reset") {
      streak = []
      continue
    }

    const outcome = fingerprint(observation.tool, observation.outcome)
    if (!outcome) {
      streak = []
      continue
    }

    const previous = streak.at(-1)
    if (!previous || previous.tool !== observation.tool || previous.fingerprint !== outcome) streak = []
    streak.push({ tool: observation.tool, fingerprint: outcome })
  }

  const latest = streak.at(-1)
  if (!latest || streak.length < threshold) return undefined
  return {
    tool: latest.tool,
    count: streak.length,
    outcome: latest.fingerprint === "empty" ? "empty" : "error",
  }
}

export function message(detection: Detection) {
  const subject = /(?:^|[_-])resources?(?:[_-]|$)/i.test(detection.tool) ? "resource" : "result"
  if (detection.outcome === "empty") {
    return `Tool "${detection.tool}" returned no matching ${subject}s ${detection.count} times in a row. No matching ${subject} was found, so OpenCode stopped the run to prevent a no-progress loop.`
  }
  return `Tool "${detection.tool}" failed with the same error ${detection.count} times in a row. OpenCode stopped the run to prevent a no-progress loop.`
}

export function stopped(value: string | undefined) {
  return value?.endsWith("OpenCode stopped the run to prevent a no-progress loop.") === true
}
