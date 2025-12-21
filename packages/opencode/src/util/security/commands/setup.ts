import { saveSecurityConfig, loadSecurityConfig, removeSecurityConfig } from "../config"
import { RESTRICTED_USER_NAME, SUDOERS_FILE_PATH, PLATFORM } from "../constants"
import { getPlatformSecurity, runSudoCommand, requestSudoAuth } from "../util"
import os from "os"

/**
 * Configure sudoers file for passwordless execution
 */
async function configureSudoers(currentUser: string, restrictedUser: string): Promise<void> {
  const sudoRule = `${currentUser} ALL=(${restrictedUser}) NOPASSWD: ${PLATFORM().SHELL}`

  // Check if rule already exists
  const existing = await Bun.file(SUDOERS_FILE_PATH)
    .text()
    .catch(() => "")

  if (existing.includes(sudoRule)) {
    console.log("✓ Sudo rule already configured")
    return
  }

  // Write to temp file, then install with sudo (sets root ownership + permissions)
  const tempFile = `/tmp/opencode-sudoers-${Date.now()}.tmp`
  await Bun.write(tempFile, sudoRule)

  const installResult = await runSudoCommand(`install -o root -g wheel -m 440 ${tempFile} ${SUDOERS_FILE_PATH}`)
  if (installResult.exitCode !== 0) {
    await runSudoCommand(`rm -f ${tempFile}`)
    throw new Error(`Failed to configure sudo: ${installResult.stderr}`)
  }

  console.log("✓ Configured sudo permissions")
}

async function validateSetup(restrictedUser: string): Promise<void> {
  const platform = getPlatformSecurity()
  if (!(await platform.userExists(restrictedUser))) {
    throw new Error("Restricted user not found")
  }

  const exists = await Bun.file(SUDOERS_FILE_PATH).exists()
  if (!exists) {
    throw new Error("Sudoers configuration not found")
  }

  const proc = Bun.spawn(["sudo", "-n", "-u", restrictedUser, "whoami"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  if (exitCode !== 0 || stdout.trim() !== restrictedUser) {
    throw new Error("Sudo execution test failed")
  }

  console.log("✓ Setup validated successfully")
}

async function rollback(restrictedUser: string): Promise<void> {
  console.log("\nRolling back changes...")

  await runSudoCommand(`rm -f ${SUDOERS_FILE_PATH}`)
    .then(() => console.log("✓ Removed sudoers configuration"))
    .catch((e) => console.warn("Could not remove sudoers:", e instanceof Error ? e.message : e))

  await getPlatformSecurity()
    .deleteUser(restrictedUser)
    .then(() => console.log("✓ Removed restricted user"))
    .catch((e) => console.warn("Could not remove user:", e instanceof Error ? e.message : e))

  await removeSecurityConfig()
    .then(() => console.log("✓ Removed configuration"))
    .catch((e) => console.warn("Could not remove config:", e instanceof Error ? e.message : e))
}

function getCurrentUser(): string {
  return process.env.USER || process.env.USERNAME || os.userInfo().username
}

export async function setupProtectedMode(): Promise<void> {
  console.log("🔒 OpenCode Protected Mode Setup\n")

  console.log("This setup requires administrator privileges.")
  await requestSudoAuth()

  try {
    const platform = getPlatformSecurity()
    await platform.createUser(RESTRICTED_USER_NAME)

    await configureSudoers(getCurrentUser(), RESTRICTED_USER_NAME)

    // Load existing config to preserve user settings
    const existingConfig = await loadSecurityConfig()

    await saveSecurityConfig({
      protectedMode: true,
      restrictedUser: RESTRICTED_USER_NAME,
      mainUser: getCurrentUser(),
      whitelistedCommands: existingConfig?.whitelistedCommands || [],
      protectedPaths: existingConfig?.protectedPaths || [],
    })

    await validateSetup(RESTRICTED_USER_NAME)

    console.log("\nConfiguration: ~/.opencode/security.json")
    console.log("\nNext steps:")
    console.log("1. Edit config: add protectedPaths + whitelistedCommands (e.g., git, npm)")
    console.log("2. Run 'opencode protect lock' to apply protection")
    console.log("3. Run 'opencode protect status' to verify")
    console.log("\n⚠️  Restart OpenCode for changes to take effect.\n")
  } catch (error) {
    console.error("\n❌ Setup failed:", error instanceof Error ? error.message : error)
    await rollback(RESTRICTED_USER_NAME)
    throw error
  }
}
