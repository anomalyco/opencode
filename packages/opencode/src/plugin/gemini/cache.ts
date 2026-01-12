import { accessTokenExpired } from "./auth"
import type { OAuthAuthDetails, PartialOAuthAuthDetails } from "./types"

const authCache = new Map<string, OAuthAuthDetails>()

function normalizeRefreshKey(refresh?: string): string | undefined {
  const key = refresh?.trim()
  return key ? key : undefined
}

export function resolveCachedAuth(auth: OAuthAuthDetails | PartialOAuthAuthDetails): OAuthAuthDetails | PartialOAuthAuthDetails {
  const key = normalizeRefreshKey(auth.refresh)
  if (!key) {
    return auth
  }

  const cached = authCache.get(key)
  if (!cached) {
    if (auth.access && typeof auth.expires === "number") {
      authCache.set(key, auth as OAuthAuthDetails)
    }
    return auth
  }

  if (!accessTokenExpired(auth)) {
    if (auth.access && typeof auth.expires === "number") {
      authCache.set(key, auth as OAuthAuthDetails)
    }
    return auth
  }

  if (!accessTokenExpired(cached)) {
    return cached
  }

  if (auth.access && typeof auth.expires === "number") {
    authCache.set(key, auth as OAuthAuthDetails)
  }
  return auth
}

export function storeCachedAuth(auth: OAuthAuthDetails): void {
  const key = normalizeRefreshKey(auth.refresh)
  if (!key) {
    return
  }
  authCache.set(key, auth)
}

export function clearCachedAuth(refresh?: string): void {
  if (!refresh) {
    authCache.clear()
    return
  }
  const key = normalizeRefreshKey(refresh)
  if (key) {
    authCache.delete(key)
  }
}
