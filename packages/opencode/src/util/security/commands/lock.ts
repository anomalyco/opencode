import { loadSecurityConfig } from "../config"
import { getFilePermissions, protectFile } from "../files"
import { validateWhitelistedCommands, rebuildSudoersFile, requestSudoAuth } from "../util"

/**
 * Apply security configuration
 * - Validates whitelisted commands
 * - Locks protected files (sets permissions to 600)
 * - Configures sudoers rules for whitelisted commands
 */
export async function applySecurityConfiguration(): Promise<void> {
  console.log("🔒 Applying security configuration...\n")

  console.log("This command requires administrator privileges.")
  await requestSudoAuth()
  console.log("")

  const config = await loadSecurityConfig()

  if (!config) {
    console.error("❌ Protected mode is not set up.")
    console.error("   Run 'opencode protect setup' first.\n")
    process.exit(1)
  }

  if (!config.protectedMode) {
    console.error("❌ Protected mode is currently disabled.")
    console.error('   Enable it by setting "protectedMode": true in ~/.opencode/security.json\n')
    process.exit(1)
  }

  // Validate whitelisted commands first (strict - must be correct)
  if (config.whitelistedCommands.length === 0) {
    console.log("- No whitelisted commands to validate")
  }

  if (config.whitelistedCommands.length > 0) {
    const valid = validateWhitelistedCommands(config.whitelistedCommands)
    if (!valid) {
      process.exit(1)
    }
    console.log("✓ All whitelisted commands are valid")
  }

  if (config.protectedPaths.length === 0) {
    console.log("- No paths configured to protect")
  }

  if (config.protectedPaths.length > 0) {
    const results = {
      locked: [] as Array<{ path: string; from: string; to: string }>,
      alreadyProtected: [] as string[],
      skipped: [] as Array<{ path: string; reason: string }>,
      failed: [] as Array<{ path: string; error: string }>,
    }

    for (const filepath of config.protectedPaths) {
      const currentPerms = await getFilePermissions(filepath)

      if (!currentPerms) {
        results.skipped.push({ path: filepath, reason: "File does not exist or cannot be read" })
        console.log(`  ⚠️  ${filepath} (not found)`)
        continue
      }

      if (currentPerms === "600") {
        results.alreadyProtected.push(filepath)
        console.log(`  ✓ ${filepath} (already protected)`)
        continue
      }

      await protectFile(filepath)
        .then(() => {
          results.locked.push({ path: filepath, from: currentPerms || "unknown", to: "600" })
          console.log(`  ✓ ${filepath} (${currentPerms} → 600)`)
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          results.failed.push({ path: filepath, error: errorMessage })
          console.log(`  ❌ ${filepath} (${errorMessage})`)
        })
    }

    const parts = []
    if (results.locked.length > 0) parts.push(`${results.locked.length} protected`)
    if (results.alreadyProtected.length > 0) parts.push(`${results.alreadyProtected.length} already protected`)
    if (results.skipped.length > 0) parts.push(`${results.skipped.length} skipped`)
    if (results.failed.length > 0) parts.push(`${results.failed.length} failed`)

    console.log(`✓ ${parts.join(", ")}`)
  }

  if (config.whitelistedCommands.length === 0) {
    console.log("- No sudoers rules to configure")
  }

  if (config.whitelistedCommands.length > 0) {
    await rebuildSudoersFile(config)
      .then(() => {
        console.log("✓ Sudoers configuration updated")
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`❌ Failed to configure sudoers: ${errorMessage}`)
        console.error(`File permissions updated. Fix sudo access and run 'opencode protect lock' again.`)
        process.exit(1)
      })
  }

  console.log("\nRun 'opencode protect status' to verify your configuration.")
  console.log("⚠️  Restart OpenCode for changes to take effect.\n")
}
