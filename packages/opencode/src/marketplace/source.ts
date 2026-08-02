import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { normalizeMarketplaceURL } from "@opencode-ai/core/marketplace"
import { Repository } from "@opencode-ai/core/repository"

const FILE_URL = /^file:/i
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/
const SCP_GIT = /^(?:[^@/\s]+@)[^:/\s]+:.+/

export type MarketplaceSourceReference = {
  url: string
  reference: string
  local: boolean
  name?: string
}

export function marketplaceGitReference(value: string) {
  const reference = Repository.parse(value)
  if (!reference || !Repository.isRemote(reference)) return
  if (reference.protocol === "ssh:" || SCP_GIT.test(value.trim())) return reference
}

export function marketplaceSourceNeedsResolution(source: { url: string; reference?: string }) {
  if (!source.reference || source.reference === source.url) return false
  if (marketplaceGitReference(source.reference)) return true
  return source.reference.startsWith("github:") || /^https:\/\/github\.com\//i.test(source.reference)
}

function expandHome(value: string) {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2))
  return value
}

function isFileReference(value: string) {
  if (FILE_URL.test(value)) return true
  if (WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value)) return true
  return !URI_SCHEME.test(value)
}

function localName(target: string, directory: boolean) {
  if (directory) return path.basename(target) || "Local marketplace"
  const filename = path.basename(target)
  if (/^marketplace\.json$/i.test(filename)) return path.basename(path.dirname(target)) || "Local marketplace"
  return path.basename(target, path.extname(target)) || filename || "Local marketplace"
}

export async function resolveMarketplaceSourceReference(
  value: string,
  cwd = process.cwd(),
): Promise<MarketplaceSourceReference> {
  const reference = value.trim()
  if (!reference) throw new Error("Marketplace catalog URL or path is required")
  if (!isFileReference(reference)) {
    return {
      url: normalizeMarketplaceURL(reference),
      reference,
      local: false,
    }
  }

  const url = FILE_URL.test(reference)
    ? new URL(normalizeMarketplaceURL(reference))
    : pathToFileURL(path.resolve(cwd, expandHome(reference)))

  let target: string | undefined
  let directory = reference.endsWith("/") || reference.endsWith("\\") || url.pathname.endsWith("/")
  try {
    target = fileURLToPath(url)
    const stat = await fs.stat(target)
    directory = stat.isDirectory()
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined
    if (code !== "ENOENT" && code !== "ENOTDIR" && target !== undefined) throw error
  }

  if (directory && !url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`
  const normalized = normalizeMarketplaceURL(url.href)
  return {
    url: normalized,
    reference,
    local: true,
    ...(target ? { name: localName(target, directory) } : {}),
  }
}
