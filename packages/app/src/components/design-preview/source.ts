export type Level = "high" | "medium" | "low" | "none"

export type SourceLoc = {
  file?: string
  line?: number
  column?: number
  component?: string
  owner?: string
  origin?: string
  confidence?: Level
  score?: number
  ambiguous?: boolean
  candidates?: Array<{ file: string; line: number; component?: string; owner?: string }>
  _debug?: string[]
}

type Info = {
  source?: SourceLoc
  definition?: SourceLoc
}

export const value = (lvl?: Level) => {
  if (lvl === "high") return 0.9
  if (lvl === "medium") return 0.7
  if (lvl === "low") return 0.4
  return 0
}

export const grade = (score?: number): Level => {
  const n = score ?? 0
  if (n >= 0.85) return "high"
  if (n >= 0.6) return "medium"
  if (n >= 0.35) return "low"
  return "none"
}

export const rank = (src?: SourceLoc) => {
  if (!src) return 0
  if (typeof src.score === "number") return src.score
  if (src.confidence) return value(src.confidence)
  if (src.file) return 0.7
  return 0
}

export const state = (src?: SourceLoc): Level => {
  return grade(rank(src))
}

export const mode = (src?: SourceLoc) => {
  const n = rank(src)
  if (n >= 0.85) return "direct" as const
  if (n >= 0.6) return "confirm" as const
  return "deny" as const
}

export const choose = (info: Info) => {
  if (info.source?.file) return info.source
  if (info.definition?.file) return info.definition
  return info.source ?? info.definition
}

export const need = (info: Info, all: boolean) => {
  return !info.source?.file && (!all || !info.definition?.file)
}
