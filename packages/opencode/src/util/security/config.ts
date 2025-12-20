import path from "path"
import os from "os"
import { chmod } from "fs/promises"

/**
 * Security Configuration
 *
 * Stored globally at ~/.opencode/security.json
 */
export interface SecurityConfig {
  protectedMode: boolean
  restrictedUser: string
  mainUser: string
  whitelistedCommands: string[]
  protectedPaths: string[]
}

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".opencode", "security.json")

/**
 * Load security configuration from global config file
 */
export async function loadSecurityConfig(): Promise<SecurityConfig | null> {
  const file = Bun.file(GLOBAL_CONFIG_PATH)
  const exists = await file.exists()

  if (!exists) {
    return null
  }

  return file.json().catch((error) => {
    console.error(`❌ Failed to load ${GLOBAL_CONFIG_PATH}`)
    console.error(`   Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`\nFix the file or delete it and rerun 'opencode protect setup'.\n`)
    process.exit(1)
  })
}

/**
 * Save security configuration to global config file
 */
export async function saveSecurityConfig(config: SecurityConfig): Promise<void> {
  await Bun.write(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2))
  await chmod(GLOBAL_CONFIG_PATH, 0o600)
}

/**
 * Remove security configuration file
 */
export async function removeSecurityConfig(): Promise<void> {
  await Bun.file(GLOBAL_CONFIG_PATH)
    .unlink()
    .catch(() => {})
}
