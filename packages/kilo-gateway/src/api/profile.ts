import { select } from "@clack/prompts"
import type { KilocodeProfile, Organization, KilocodeBalance } from "../types.js"
import { KILO_API_BASE, DEFAULT_MODEL, DEFAULT_FREE_MODEL } from "./constants.js"

/**
 * Fetch user profile from Kilo API
 */
export async function fetchProfile(token: string): Promise<KilocodeProfile> {
  const response = await fetch(`${KILO_API_BASE}/api/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid token")
    }
    throw new Error(`Failed to fetch profile: ${response.status}`)
  }

  const data = (await response.json()) as {
    user?: { email?: string; name?: string }
    email?: string
    name?: string
    organizations?: Organization[]
  }
  // Backend returns { user: { email, name, ... }, organizations }
  // Transform to flat KilocodeProfile structure
  return {
    email: data.user?.email ?? data.email ?? "",
    name: data.user?.name ?? data.name,
    organizations: data.organizations,
  }
}

/**
 * Alias for compatibility with existing code
 */
export const getKiloProfile = fetchProfile

/**
 * Fetch user balance from Kilo API
 * @param token - Authentication token
 * @param organizationId - Optional organization ID for team balance
 */
export async function fetchBalance(token: string, organizationId?: string): Promise<KilocodeBalance | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }
    if (organizationId) {
      headers["x-kilocode-organizationid"] = organizationId
    }

    const response = await fetch(`${KILO_API_BASE}/api/profile/balance`, { headers })

    if (!response.ok) {
      console.warn(`Failed to fetch balance: ${response.status}`)
      return null
    }

    const data = (await response.json()) as { balance?: number }
    return { balance: data.balance ?? 0 }
  } catch (error) {
    console.warn("Error fetching balance:", error)
    return null
  }
}

/**
 * Alias for compatibility with existing code
 */
export const getKiloBalance = fetchBalance

/**
 * Fetch default model for a given organization context
 * When token is provided, returns the authenticated user's default model
 * When no token is provided, returns the default free model for anonymous usage
 */
export async function fetchDefaultModel(token?: string, organizationId?: string): Promise<string> {
  const path = organizationId ? `/api/organizations/${organizationId}/defaults` : `/api/defaults`
  const url = `${KILO_API_BASE}${path}`

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(url, { headers })

    if (!response.ok) {
      return token ? DEFAULT_MODEL : DEFAULT_FREE_MODEL
    }

    const data = (await response.json()) as { defaultModel?: string; defaultFreeModel?: string }
    if (token) {
      return data.defaultModel || DEFAULT_MODEL
    }
    return data.defaultFreeModel || DEFAULT_FREE_MODEL
  } catch {
    return token ? DEFAULT_MODEL : DEFAULT_FREE_MODEL
  }
}

/**
 * Alias for compatibility with existing code
 */
export const getKiloDefaultModel = fetchDefaultModel

/**
 * Fetch both profile and balance in parallel
 */
export async function fetchProfileWithBalance(token: string): Promise<{
  profile: KilocodeProfile
  balance: KilocodeBalance | null
}> {
  const [profile, balance] = await Promise.all([fetchProfile(token), fetchBalance(token)])
  return { profile, balance }
}

/**
 * Prompt user to select an organization or personal account
 * @param organizations List of organizations the user belongs to
 * @returns Organization ID or undefined for personal account
 */
export async function promptOrganizationSelection(organizations: Organization[]): Promise<string | undefined> {
  if (!organizations || organizations.length === 0) {
    return undefined
  }

  const choices = [
    { label: "Personal Account", value: "personal", hint: "Use your personal account" },
    ...organizations.map((org) => ({
      label: org.name,
      value: org.id,
      hint: `Organization`,
    })),
  ]

  const result = await select({
    message: "Select account",
    options: choices,
  })

  if (result === "personal") {
    return undefined
  }

  return result as string
}
