import { CODE_ASSIST_HEADERS, GEMINI_CODE_ASSIST_ENDPOINT, GEMINI_PROVIDER_ID } from "./constants"
import { formatRefreshParts, parseRefreshParts } from "./auth"
import type { OAuthAuthDetails, PluginClient, ProjectContextResult } from "./types"

const projectContextResultCache = new Map<string, ProjectContextResult>()
const projectContextPendingCache = new Map<string, Promise<ProjectContextResult>>()

const CODE_ASSIST_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const

interface GeminiUserTier {
  id?: string
  isDefault?: boolean
  userDefinedCloudaicompanionProject?: boolean
}

interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string
  currentTier?: {
    id?: string
  }
  allowedTiers?: GeminiUserTier[]
}

interface OnboardUserPayload {
  done?: boolean
  response?: {
    cloudaicompanionProject?: {
      id?: string
    }
  }
}

class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      "Google Gemini requires a Google Cloud project. Enable the Gemini for Google Cloud API on a project you control, then set `provider.google.options.projectId` in your Opencode config (or set OPENCODE_GEMINI_PROJECT_ID).",
    )
  }
}

function buildMetadata(projectId?: string): Record<string, string> {
  const metadata: Record<string, string> = {
    ideType: CODE_ASSIST_METADATA.ideType,
    platform: CODE_ASSIST_METADATA.platform,
    pluginType: CODE_ASSIST_METADATA.pluginType,
  }
  if (projectId) {
    metadata.duetProject = projectId
  }
  return metadata
}

function getDefaultTierId(allowedTiers?: GeminiUserTier[]): string | undefined {
  if (!allowedTiers || allowedTiers.length === 0) {
    return undefined
  }
  for (const tier of allowedTiers) {
    if (tier?.isDefault) {
      return tier.id
    }
  }
  return allowedTiers[0]?.id
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getCacheKey(auth: OAuthAuthDetails): string | undefined {
  const refresh = auth.refresh?.trim()
  return refresh ? refresh : undefined
}

export function invalidateProjectContextCache(refresh?: string): void {
  if (!refresh) {
    projectContextPendingCache.clear()
    projectContextResultCache.clear()
    return
  }

  projectContextPendingCache.delete(refresh)
  projectContextResultCache.delete(refresh)

  const prefix = `${refresh}|cfg:`
  for (const key of projectContextPendingCache.keys()) {
    if (key.startsWith(prefix)) {
      projectContextPendingCache.delete(key)
    }
  }
  for (const key of projectContextResultCache.keys()) {
    if (key.startsWith(prefix)) {
      projectContextResultCache.delete(key)
    }
  }
}

export async function loadManagedProject(accessToken: string, projectId?: string): Promise<LoadCodeAssistPayload | null> {
  try {
    const metadata = buildMetadata(projectId)

    const requestBody: Record<string, unknown> = { metadata }
    if (projectId) {
      requestBody.cloudaicompanionProject = projectId
    }

    const response = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...CODE_ASSIST_HEADERS,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      return null
    }

    return (await response.json()) as LoadCodeAssistPayload
  } catch (error) {
    console.error("Failed to load Gemini managed project:", error)
    return null
  }
}

export async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
  attempts = 10,
  delayMs = 5000,
): Promise<string | undefined> {
  const metadata = buildMetadata(projectId)
  const requestBody: Record<string, unknown> = {
    tierId,
    metadata,
  }

  if (tierId !== "FREE") {
    if (!projectId) {
      throw new ProjectIdRequiredError()
    }
    requestBody.cloudaicompanionProject = projectId
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...CODE_ASSIST_HEADERS,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        return undefined
      }

      const payload = (await response.json()) as OnboardUserPayload
      const managedProjectId = payload.response?.cloudaicompanionProject?.id
      if (payload.done && managedProjectId) {
        return managedProjectId
      }
      if (payload.done && projectId) {
        return projectId
      }
    } catch (error) {
      console.error("Failed to onboard Gemini managed project:", error)
      return undefined
    }

    await wait(delayMs)
  }

  return undefined
}

export async function ensureProjectContext(
  auth: OAuthAuthDetails,
  client: PluginClient,
  configuredProjectId?: string,
): Promise<ProjectContextResult> {
  const accessToken = auth.access
  if (!accessToken) {
    return { auth, effectiveProjectId: "" }
  }

  const cacheKey = (() => {
    const base = getCacheKey(auth)
    if (!base) return undefined
    const project = configuredProjectId?.trim() ?? ""
    return project ? `${base}|cfg:${project}` : base
  })()
  if (cacheKey) {
    const cached = projectContextResultCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const pending = projectContextPendingCache.get(cacheKey)
    if (pending) {
      return pending
    }
  }

  const resolveContext = async (): Promise<ProjectContextResult> => {
    const parts = parseRefreshParts(auth.refresh)
    const effectiveConfiguredProjectId = configuredProjectId?.trim() || undefined
    const projectId = effectiveConfiguredProjectId ?? parts.projectId

    if (projectId || parts.managedProjectId) {
      return {
        auth,
        effectiveProjectId: projectId || parts.managedProjectId || "",
      }
    }

    const loadPayload = await loadManagedProject(accessToken, projectId)
    if (loadPayload?.cloudaicompanionProject) {
      const managedProjectId = loadPayload.cloudaicompanionProject
      const updatedAuth: OAuthAuthDetails = {
        ...auth,
        refresh: formatRefreshParts({
          refreshToken: parts.refreshToken,
          projectId,
          managedProjectId,
        }),
      }

      await client.auth.set({
        path: { id: GEMINI_PROVIDER_ID },
        body: updatedAuth,
      })

      return { auth: updatedAuth, effectiveProjectId: managedProjectId }
    }

    if (!loadPayload) {
      throw new ProjectIdRequiredError()
    }

    const currentTierId = loadPayload.currentTier?.id ?? undefined
    if (currentTierId && currentTierId !== "FREE") {
      throw new ProjectIdRequiredError()
    }

    const defaultTierId = getDefaultTierId(loadPayload.allowedTiers)
    const tierId = defaultTierId ?? "FREE"

    if (tierId !== "FREE") {
      throw new ProjectIdRequiredError()
    }

    const managedProjectId = await onboardManagedProject(accessToken, tierId, projectId)
    if (managedProjectId) {
      const updatedAuth: OAuthAuthDetails = {
        ...auth,
        refresh: formatRefreshParts({
          refreshToken: parts.refreshToken,
          projectId,
          managedProjectId,
        }),
      }

      await client.auth.set({
        path: { id: GEMINI_PROVIDER_ID },
        body: updatedAuth,
      })

      return { auth: updatedAuth, effectiveProjectId: managedProjectId }
    }

    throw new ProjectIdRequiredError()
  }

  if (!cacheKey) {
    return resolveContext()
  }

  const promise = resolveContext()
    .then((result) => {
      const nextKey = getCacheKey(result.auth) ?? cacheKey
      projectContextPendingCache.delete(cacheKey)
      projectContextResultCache.set(nextKey, result)
      if (nextKey !== cacheKey) {
        projectContextResultCache.delete(cacheKey)
      }
      return result
    })
    .catch((error) => {
      projectContextPendingCache.delete(cacheKey)
      throw error
    })

  projectContextPendingCache.set(cacheKey, promise)
  return promise
}
