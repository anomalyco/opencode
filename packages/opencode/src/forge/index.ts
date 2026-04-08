import type { ForgePlatform } from "./types"

export type ParsedRemote = {
  platform: ForgePlatform
  host: string
  owner: string
  repo: string
}

export function parseRemote(url: string): ParsedRemote | null {
  const github = parseGitHubRemote(url)
  if (github) return { platform: "github", ...github }

  const gitea = parseGiteaRemote(url)
  if (gitea) return { platform: "gitea", ...gitea }

  return null
}

function parseGitHubRemote(url: string): { host: string; owner: string; repo: string } | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { host: "github.com", owner: match[1], repo: match[2] }
}

function parseGiteaRemote(url: string): { host: string; owner: string; repo: string } | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  if (match[1].includes("github.com")) return null
  return { host: match[1], owner: match[2], repo: match[3] }
}
