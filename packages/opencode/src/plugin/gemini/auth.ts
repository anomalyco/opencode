import type { AuthDetails, OAuthAuthDetails, PartialAuthDetails, PartialOAuthAuthDetails, RefreshParts } from "./types"

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

export function isOAuthAuth(auth: AuthDetails | PartialAuthDetails): auth is OAuthAuthDetails | PartialOAuthAuthDetails {
  return auth.type === "oauth"
}

export function isFullOAuthAuth(auth: AuthDetails | PartialAuthDetails): auth is OAuthAuthDetails {
  return auth.type === "oauth" && typeof auth.access === "string" && typeof auth.expires === "number"
}

export function parseRefreshParts(refresh: string): RefreshParts {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = (refresh ?? "").split("|")
  return {
    refreshToken,
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined,
  }
}

export function formatRefreshParts(parts: RefreshParts): string {
  if (!parts.refreshToken) {
    return ""
  }

  if (!parts.projectId && !parts.managedProjectId) {
    return parts.refreshToken
  }

  const projectSegment = parts.projectId ?? ""
  const managedSegment = parts.managedProjectId ?? ""
  return `${parts.refreshToken}|${projectSegment}|${managedSegment}`
}

export function accessTokenExpired(auth: OAuthAuthDetails | PartialOAuthAuthDetails): boolean {
  if (!auth.access || typeof auth.expires !== "number") {
    return true
  }
  return auth.expires <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS
}
