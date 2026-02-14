// kilocode_change - new file
/**
 * Legacy Kilo CLI migration module
 *
 * Migrates authentication from the legacy Kilo Code VS Code extension CLI
 * config path (~/.kilocode/cli/config.json) to the new auth.json format.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"

export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".kilocode", "cli", "config.json")

interface LegacyProvider {
  id: string
  provider: string
  kilocodeToken?: string
  kilocodeModel?: string
  kilocodeOrganizationId?: string
}

interface LegacyConfig {
  providers?: LegacyProvider[]
}

interface LegacyKiloAuth {
  token: string
  organizationId?: string
}

// Auth info types matching opencode's Auth module
type ApiAuth = { type: "api"; key: string }
type OAuthAuth = { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
type AuthInfo = ApiAuth | OAuthAuth

/**
 * Extract kilo auth from legacy config
 */
function extractKiloAuth(config: LegacyConfig): LegacyKiloAuth | undefined {
  if (!config.providers) return undefined

  const provider = config.providers.find((p) => p.provider === "kilocode")
  if (!provider?.kilocodeToken) return undefined

  return {
    token: provider.kilocodeToken,
    organizationId: provider.kilocodeOrganizationId,
  }
}

/**
 * Migrate Kilo authentication from legacy CLI config path.
 *
 * Checks ~/.kilocode/cli/config.json for existing kilo credentials
 * and migrates them to the new auth.json format.
 *
 * @param hasKiloAuth - Callback to check if kilo auth already exists
 * @param saveKiloAuth - Callback to save the migrated auth
 * @returns true if migration was performed, false otherwise
 */
export async function migrateLegacyKiloAuth(
  hasKiloAuth: () => Promise<boolean>,
  saveKiloAuth: (auth: AuthInfo) => Promise<void>,
): Promise<boolean> {
  // Skip if kilo auth already configured
  if (await hasKiloAuth()) return false

  // Check if legacy config exists and parse it
  const content = await fs.readFile(LEGACY_CONFIG_PATH, "utf-8").catch(() => null)
  if (!content) return false

  let config: LegacyConfig | null = null
  try {
    config = JSON.parse(content) as LegacyConfig
  } catch {
    return false
  }

  // Extract kilo auth from legacy config
  const legacy = extractKiloAuth(config)
  if (!legacy) return false

  // Migrate to new format
  // Use OAuth format if organization ID present, otherwise API format
  if (legacy.organizationId) {
    await saveKiloAuth({
      type: "oauth",
      access: legacy.token,
      refresh: "",
      expires: 0,
      accountId: legacy.organizationId,
    })
  } else {
    await saveKiloAuth({
      type: "api",
      key: legacy.token,
    })
  }

  return true
}
