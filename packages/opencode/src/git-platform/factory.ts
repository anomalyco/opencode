import type { Platform, PlatformConfig, RemoteInfo } from "./types"
import type { IGitPlatform } from "./interface"

const KNOWN_HOSTS: Record<string, Platform> = {
  "github.com": "github",
  "codeberg.org": "forgejo",
  "gitea.com": "gitea",
}

export function parseRemoteUrl(url: string): RemoteInfo | null {
  const patterns = [
    /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/,
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      const [, host, owner, repo] = match
      const platform = KNOWN_HOSTS[host] || guessFromHost(host)
      const baseUrl = host === "github.com" ? "https://api.github.com" : `https://${host}`
      return { platform, baseUrl, owner, repo }
    }
  }

  return null
}

function guessFromHost(host: string): Platform {
  const lower = host.toLowerCase()
  if (lower.includes("forgejo")) return "forgejo"
  if (lower.includes("codeberg")) return "forgejo"
  if (lower.includes("gitea")) return "gitea"
  return "gitea"
}

export async function detectPlatform(baseUrl: string, token?: string): Promise<Platform> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "opencode",
  }
  if (token) {
    headers.Authorization = `token ${token}`
  }

  const url = baseUrl.includes("api.github.com") ? baseUrl : `${baseUrl}/api/v1/version`

  if (baseUrl.includes("github.com") || baseUrl.includes("api.github.com")) {
    return "github"
  }

  try {
    const response = await fetch(url, { headers })
    if (!response.ok) return "gitea"

    const data = (await response.json()) as { version?: string }
    const version = data.version?.toLowerCase() || ""

    if (version.includes("forgejo")) return "forgejo"
    return "gitea"
  } catch {
    return "gitea"
  }
}

export async function createPlatformAdapter(config: PlatformConfig & { platform?: Platform }): Promise<IGitPlatform> {
  const platform = config.platform || (await detectPlatform(config.baseUrl, config.token))

  switch (platform) {
    case "github": {
      const { GitHubAdapter } = await import("./github/adapter")
      return new GitHubAdapter(config)
    }
    case "forgejo": {
      const { ForgejoAdapter } = await import("./forgejo/adapter")
      return new ForgejoAdapter(config)
    }
    case "gitea":
    default: {
      const { GiteaAdapter } = await import("./gitea/adapter")
      return new GiteaAdapter(config)
    }
  }
}

export function getPlatformFromEnv(): { baseUrl: string; token: string; botUsername: string } | null {
  const giteaUrl = process.env.OPENCODE_GIT_URL
  const giteaToken = process.env.OPENCODE_BOT_TOKEN || process.env.OPENCODE_GIT_TOKEN

  if (giteaUrl && giteaToken) {
    return {
      baseUrl: giteaUrl,
      token: giteaToken,
      botUsername: process.env.OPENCODE_BOT_USERNAME || "opencode-bot",
    }
  }

  const githubToken = process.env.GITHUB_TOKEN
  if (githubToken) {
    return {
      baseUrl: "https://api.github.com",
      token: githubToken,
      botUsername: process.env.GITHUB_BOT_USERNAME || "github-actions[bot]",
    }
  }

  return null
}
