import { PLATFORM, SUDOERS_FILE_PATH } from "./constants"
import type { SecurityConfig } from "./config"
import { DarwinSecurity } from "./platform/darwin"
import type { PlatformSecurity } from "./platform/interface"

/**
 * Run sudo command (non-interactive, assumes auth cached)
 */
export async function runSudoCommand(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["sudo", "-n", PLATFORM.SHELL, "-c", cmd], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return { exitCode, stdout, stderr }
}

/**
 * Request sudo authentication upfront (interactive)
 * Prompts user for password if needed
 * Also validates that sudo is actually working (not just cached credentials)
 */
export async function requestSudoAuth(): Promise<void> {
  const proc = Bun.spawn(["sudo", "-v"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error("Sudo authentication failed")
  }

  // Verify sudo actually works (catches issues like broken sudoers files)
  const testProc = Bun.spawn(["sudo", "-n", "whoami"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const testOutput = await new Response(testProc.stdout).text()
  const testExit = await testProc.exited

  if (testExit !== 0 || testOutput.trim() !== "root") {
    throw new Error("Sudo validation failed - check sudoers configuration")
  }
}

/**
 * Get platform-specific security implementation
 * Currently supports macOS only
 */
export function getPlatformSecurity(): PlatformSecurity {
  if (process.platform === "darwin") {
    return new DarwinSecurity(runSudoCommand)
  }
  throw new Error(`Platform ${process.platform} not yet supported for protected mode`)
}

/**
 * Detect absolute path of a command binary
 * Returns null if command not found in PATH
 */
export async function detectBinaryPath(command: string): Promise<string | null> {
  const proc = Bun.spawn(["which", command], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  if (exitCode !== 0 || !stdout.trim()) {
    return null
  }

  return stdout.trim()
}

/**
 * Validate whitelisted commands
 * Returns false if validation fails (errors are logged to console)
 */
export function validateWhitelistedCommands(commands: string[]): boolean {
  const errors: string[] = []

  for (const command of commands) {
    if (command.trim() === "") {
      errors.push("Empty command found")
      continue
    }

    // Check for valid command name (alphanumeric + common separators)
    if (!/^[a-zA-Z0-9_.\+-]+$/.test(command)) {
      errors.push(`"${command}" - must be a simple command name`)
      continue
    }
  }

  if (errors.length > 0) {
    console.error("❌ Invalid whitelisted commands found:")
    for (const error of errors) {
      console.error(`   • ${error}`)
    }
    console.error("")
    return false
  }

  return true
}

/**
 * Rebuild sudoers file from security configuration
 * Creates rules for:
 * 1. Main user → restricted user (base rule for command execution)
 * 2. Restricted user → main user for each whitelisted command
 */
export async function rebuildSudoersFile(config: SecurityConfig): Promise<void> {
  const rules: string[] = []

  // Base rule: Allow main user to execute commands as restricted user
  rules.push(`${config.mainUser} ALL=(${config.restrictedUser}) NOPASSWD: ${PLATFORM.SHELL}`)

  // Whitelisted command rules: Allow restricted user to run whitelisted commands as main user
  for (const command of config.whitelistedCommands) {
    const binaryPath = await detectBinaryPath(command)

    if (!binaryPath) {
      console.warn(`  ⚠️  Command '${command}' not found in PATH. Skipping sudoers rule.`)
      console.warn(`      Install ${command} and run 'opencode protect lock' again to enable.`)
      continue
    }

    rules.push(`${config.restrictedUser} ALL=(${config.mainUser}) NOPASSWD: ${binaryPath}`)
  }

  // Write sudoers file using Bun.write
  const sudoersContent = rules.join("\n")
  const userTempFile = `/tmp/opencode-sudoers-${Date.now()}.tmp`
  const sudoersTempFile = `${SUDOERS_FILE_PATH}.tmp`

  // Write to temp file in /tmp (no sudo needed)
  await Bun.write(userTempFile, sudoersContent)

  // Install to /etc/sudoers.d/ for validation (requires sudo, sets root ownership)
  const installToValidateResult = await runSudoCommand(
    `install -o root -g wheel -m 440 ${userTempFile} ${sudoersTempFile}`,
  )
  if (installToValidateResult.exitCode !== 0) {
    await runSudoCommand(`rm -f ${userTempFile}`)
    throw new Error(`Failed to write sudoers file: ${installToValidateResult.stderr}`)
  }

  // Validate syntax with visudo
  const validateResult = await runSudoCommand(`visudo -c -f ${sudoersTempFile}`)
  if (validateResult.exitCode !== 0) {
    await runSudoCommand(`rm -f ${sudoersTempFile}`)
    throw new Error(`Sudoers syntax validation failed: ${validateResult.stderr}`)
  }

  // Install temp file to actual location (sets root ownership + permissions)
  const installResult = await runSudoCommand(`install -o root -g wheel -m 440 ${sudoersTempFile} ${SUDOERS_FILE_PATH}`)
  if (installResult.exitCode !== 0) {
    await runSudoCommand(`rm -f ${sudoersTempFile}`)
    throw new Error(`Failed to update sudoers file: ${installResult.stderr}`)
  }

  // Clean up temp files on success
  await runSudoCommand(`rm -f ${userTempFile} ${sudoersTempFile}`)
}
