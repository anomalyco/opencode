import { createHash } from "crypto"
import path from "path"

export interface RequirementSource {
  type: "file" | "inline" | "fallback"
  path?: string
  contentHash: string
}

export interface RequirementIdentity {
  id: string
  title: string
  request: string
  requirementText: string
  requirementSource: RequirementSource
}

const TERM_MAP: Array<[RegExp, string]> = [
  [/外汇|汇率|币种|兑换|exchange|currency/i, "fx-rate"],
  [/查询|检索|搜索|query|search/i, "query"],
  [/系统|平台|应用|system|platform|app/i, "system"],
]

const EXPLICIT_ID_PATTERNS = [
  /(?:--feature-id|--feature)\s+([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)/i,
  /featureId\s*=\s*([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)/i,
  /feature\s*=\s*([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)/i,
  /Feature\s+ID\s*[:：]\s*([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)/i,
  /(?:^|[\s，,])([A-Za-z]\d{4,})(?=$|[\s，,])/,
  /[\\/](?:requirements?|需求)?[\\/]?([A-Za-z]\d{4,})(?=[\\/])/i,
]

export async function resolveFeatureIdentity(
  userRequest: string,
  directory: string,
): Promise<RequirementIdentity> {
  const request = userRequest.trim()
  const explicitId = extractExplicitFeatureId(request)
  const explicitTitle = extractExplicitFeatureTitle(request)
  const sourcePath = parseRequirementFilePath(request)
  const source = sourcePath ? await readRequirementFile(sourcePath, directory) : null

  const requirementText = source?.text || stripControlArgs(request) || request
  const contentHash = hashRequirement(requirementText)
  const title = explicitTitle || extractRequirementTitle(requirementText) || explicitId || "未命名需求"
  const slug = toSemanticSlug(title)
  const id = explicitId || `${slug || "feature"}-${contentHash.slice(0, 8)}`

  return {
    id: sanitizeFeatureId(id),
    title,
    request,
    requirementText,
    requirementSource: {
      type: source ? "file" : requirementText ? "inline" : "fallback",
      path: source?.path,
      contentHash: `sha256:${contentHash}`,
    },
  }
}

export function extractRequirementTitle(text: string): string {
  const normalized = normalizeText(text)
  const heading = normalized.match(/^#\s+(.+)$/m)
  if (heading?.[1]?.trim()) return cleanTitle(heading[1])

  const patterns = [
    /开发(.+?系统)/,
    /建设(.+?系统)/,
    /实现(.+?系统)/,
    /新增(.+?功能)/,
    /构建(.+?平台)/,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1]?.trim()) return cleanTitle(match[1])
  }

  const firstSentence = normalized.split(/[。！？\n]/)[0]?.trim()
  return cleanTitle(firstSentence?.slice(0, 30) || "")
}

export function toSemanticSlug(title: string): string {
  const parts: string[] = []
  for (const [pattern, token] of TERM_MAP) {
    if (pattern.test(title) && !parts.includes(token)) {
      parts.push(token)
    }
  }

  if (parts.length > 0) return parts.join("-")

  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return ascii || "feature"
}

function extractExplicitFeatureId(request: string): string | null {
  for (const pattern of EXPLICIT_ID_PATTERNS) {
    const match = request.match(pattern)
    if (match?.[1]) return sanitizeFeatureId(match[1])
  }
  return null
}

function extractExplicitFeatureTitle(request: string): string | null {
  const match = request.match(/(?:--feature-name|--title)\s+(?:"([^"]+)"|'([^']+)'|([^\s，,]+))/i)
  const title = match?.[1] || match?.[2] || match?.[3]
  return title ? cleanTitle(title) : null
}

function parseRequirementFilePath(request: string): string | null {
  const quoted = request.match(/["']([^"']+\.(?:md|txt|docx?))["']/i)
  if (quoted?.[1]) return normalizePathForStorage(quoted[1])

  const atRef = request.match(/@([^\s，,]+\.(?:md|txt|docx?))/i)
  if (atRef?.[1]) return normalizePathForStorage(atRef[1])

  const readRef = request.match(/(?:读取|read)\s*([^\s，,]+\.(?:md|txt|docx?))/i)
  if (readRef?.[1]) return normalizePathForStorage(readRef[1])

  const bare = request.match(/(?:^|[\s，,])([./\\\w\u4e00-\u9fff-]+\.(?:md|txt|docx?))(?:$|[\s，,])/i)
  return bare?.[1] ? normalizePathForStorage(bare[1]) : null
}

async function readRequirementFile(
  sourcePath: string,
  directory: string,
): Promise<{ path: string; text: string } | null> {
  try {
    const absolute = path.resolve(directory, sourcePath)
    const file = Bun.file(absolute)
    if (!(await file.exists())) return null
    return { path: sourcePath, text: await file.text() }
  } catch {
    return null
  }
}

function hashRequirement(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex")
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim()
}

function stripControlArgs(request: string): string {
  return request
    .replace(/(?:--feature-id|--feature)\s+[^\s，,]+/gi, "")
    .replace(/(?:--feature-name|--title)\s+(?:"[^"]+"|'[^']+'|[^\s，,]+)/gi, "")
    .trim()
}

function cleanTitle(title: string): string {
  return title
    .replace(/[，,。；;：:].*$/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
}

function sanitizeFeatureId(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim()
    || "feature"
}

function normalizePathForStorage(value: string): string {
  return value.replace(/\\/g, "/")
}
