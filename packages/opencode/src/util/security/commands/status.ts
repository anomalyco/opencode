import { loadSecurityConfig } from "../config"
import { getFilePermissions } from "../files"

export async function showSecurityStatus(): Promise<void> {
  const config = await loadSecurityConfig()

  if (!config) {
    console.log("Protected Mode: DISABLED")
    console.log("\nRun 'opencode protect setup' to enable protected mode.")
    return
  }

  const protectedMode = config.protectedMode
  const protectedPaths = config.protectedPaths
  const whitelistedCommands = config.whitelistedCommands

  console.log(`Protected Mode: ${protectedMode ? "ENABLED" : "DISABLED"}`)
  console.log(`Restricted User: ${config.restrictedUser}`)
  console.log(`Whitelisted Commands: ${whitelistedCommands.length > 0 ? whitelistedCommands.join(", ") : "None"}`)
  console.log()

  console.log(`Protected Paths (${protectedPaths.length}):`)

  interface Issue {
    path: string
    issue: string
    suggestion: string
  }

  const issues: Issue[] = []

  for (const filepath of protectedPaths) {
    const perms = await getFilePermissions(filepath)

    if (!perms) {
      console.log(`  ⚠️  ${filepath} (DOES NOT EXIST OR CANNOT BE READ)`)
      issues.push({
        path: filepath,
        issue: "does not exist or cannot be read",
        suggestion: "Remove from config or create the file",
      })
      continue
    }

    if (perms === "600") {
      console.log(`  ✓ ${filepath} (${perms})`)
      continue
    }

    console.log(`  ⚠️  ${filepath} (${perms}) - Should be 600`)
    issues.push({
      path: filepath,
      issue: `has permissions ${perms} (should be 600)`,
      suggestion: "Run 'opencode protect lock' to fix permissions",
    })
  }

  if (protectedPaths.length > 0) {
    console.log()
  }

  if (issues.length > 0) {
    console.log()
    console.log("Issues Found:")
    for (const { path, issue, suggestion } of issues) {
      console.log(`  • ${path} ${issue}`)
      console.log(`    ${suggestion}`)
    }
    console.log()
  }

  if (!protectedMode) {
    console.log("⚠️  Protected mode is disabled. Run 'opencode protect setup' to enable.")
    return
  }

  console.log()
  console.log("⚠️  Restart OpenCode for changes to take effect.")
}
