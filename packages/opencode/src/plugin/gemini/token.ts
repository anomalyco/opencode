import { GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET, GEMINI_PROVIDER_ID } from "./constants"
import { formatRefreshParts, parseRefreshParts } from "./auth"
import { storeCachedAuth } from "./cache"
import { invalidateProjectContextCache } from "./project"
import type { OAuthAuthDetails, PartialOAuthAuthDetails, PluginClient, RefreshParts } from "./types"

interface OAuthErrorPayload {
  error?:
    | string
    | {
        code?: string
        status?: string
        message?: string
      }
  error_description?: string
}

function parseOAuthErrorPayload(text: string | undefined): { code?: string; description?: string } {
  if (!text) {
    return {}
  }

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload
    if (!payload || typeof payload !== "object") {
      return { description: text }
    }

    let code: string | undefined
    if (typeof payload.error === "string") {
      code = payload.error
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code
      if (!payload.error_description && payload.error.message) {
        return { code, description: payload.error.message }
      }
    }

    const description = payload.error_description
    if (description) {
      return { code, description }
    }

    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message }
    }

    return { code }
  } catch {
    return { description: text }
  }
}

export async function refreshAccessToken(
  auth: OAuthAuthDetails | PartialOAuthAuthDetails,
  client: PluginClient,
): Promise<OAuthAuthDetails | undefined> {
  const parts = parseRefreshParts(auth.refresh)
  if (!parts.refreshToken) {
    return undefined
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: parts.refreshToken,
        client_id: GEMINI_CLIENT_ID,
        client_secret: GEMINI_CLIENT_SECRET,
      }),
    })

    if (!response.ok) {
      let errorText: string | undefined
      try {
        errorText = await response.text()
      } catch {
        errorText = undefined
      }

      const { code, description } = parseOAuthErrorPayload(errorText)
      const details = [code, description ?? errorText].filter(Boolean).join(": ")
      const baseMessage = `Gemini token refresh failed (${response.status} ${response.statusText})`
      console.warn(`[Gemini OAuth] ${details ? `${baseMessage} - ${details}` : baseMessage}`)

      if (code === "invalid_grant") {
        console.warn(
          "[Gemini OAuth] Google revoked the stored refresh token. Run `opencode auth login` and reauthenticate the Google provider.",
        )
        invalidateProjectContextCache(auth.refresh)
        try {
          // Clear the credentials by setting empty/expired values
          const clearedAuth: OAuthAuthDetails = {
            type: "oauth",
            refresh: formatRefreshParts({
              refreshToken: "",
              projectId: parts.projectId,
              managedProjectId: parts.managedProjectId,
            }),
            access: "",
            expires: 0,
          }
          await client.auth.set({
            path: { id: GEMINI_PROVIDER_ID },
            body: clearedAuth,
          })
        } catch (storeError) {
          console.error("Failed to clear stored Gemini OAuth credentials:", storeError)
        }
      }

      return undefined
    }

    const payload = (await response.json()) as {
      access_token: string
      expires_in: number
      refresh_token?: string
    }

    const refreshedParts: RefreshParts = {
      refreshToken: payload.refresh_token ?? parts.refreshToken,
      projectId: parts.projectId,
      managedProjectId: parts.managedProjectId,
    }

    const updatedAuth: OAuthAuthDetails = {
      type: "oauth",
      access: payload.access_token,
      expires: Date.now() + payload.expires_in * 1000,
      refresh: formatRefreshParts(refreshedParts),
    }

    storeCachedAuth(updatedAuth)
    invalidateProjectContextCache(auth.refresh)

    try {
      await client.auth.set({
        path: { id: GEMINI_PROVIDER_ID },
        body: updatedAuth,
      })
    } catch (storeError) {
      console.error("Failed to persist refreshed Gemini OAuth credentials:", storeError)
    }

    return updatedAuth
  } catch (error) {
    console.error("Failed to refresh Gemini access token due to an unexpected error:", error)
    return undefined
  }
}
