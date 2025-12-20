import { $ } from "bun"
import { MACOS } from "../constants"
import type { PlatformSecurity, UserCreationResult, SudoCommand } from "./interface"

/**
 * macOS security implementation using dscl (Directory Service Command Line)
 */
export class DarwinSecurity implements PlatformSecurity {
  constructor(private runSudoCommand: SudoCommand) {}

  async userExists(username: string): Promise<boolean> {
    const result = await $`dscl . -read /Users/${username}`.quiet().nothrow()
    return result.exitCode === 0
  }

  async createUser(username: string): Promise<UserCreationResult> {
    if (await this.userExists(username)) {
      console.log(`✓ User ${username} already exists`)
      await this.updateUserGroup(username)
      return { success: true, userCreated: false }
    }

    const uid = await this.findAvailableUID()

    const createCommands = [
      `dscl . -create /Users/${username}`,
      `dscl . -create /Users/${username} UserShell ${MACOS.SHELL}`,
      `dscl . -create /Users/${username} UniqueID ${uid}`,
      `dscl . -create /Users/${username} PrimaryGroupID ${MACOS.GROUP_ID}`,
      `dscl . -create /Users/${username} NFSHomeDirectory ${MACOS.USER_HOME}`,
    ]

    for (const cmd of createCommands) {
      const result = await this.runSudoCommand(cmd)
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create user: ${result.stderr}`)
      }
    }

    console.log(`✓ Created user ${username}`)
    return { success: true, userCreated: true }
  }

  async deleteUser(username: string): Promise<void> {
    const result = await this.runSudoCommand(`dscl . -delete /Users/${username}`)
    if (result.exitCode !== 0) {
      throw new Error(`Failed to delete user: ${result.stderr}`)
    }
  }

  async updateUserGroup(username: string): Promise<void> {
    const result = await this.runSudoCommand(`dscl . -create /Users/${username} PrimaryGroupID ${MACOS.GROUP_ID}`)

    if (result.exitCode !== 0) {
      throw new Error(`Failed to update group: ${result.stderr}`)
    }

    console.log("✓ Updated primary group")
  }

  private async findAvailableUID(): Promise<number> {
    // Use high UID to avoid conflicts with system users
    for (let uid = MACOS.UID_RANGE.START; uid >= MACOS.UID_RANGE.END; uid--) {
      const inUse = await $`dscl . -list /Users UniqueID | grep -q " ${uid}$"`.quiet().nothrow()

      if (inUse.exitCode !== 0) {
        return uid
      }
    }

    // Fallback if all high UIDs are taken
    return MACOS.UID_RANGE.FALLBACK
  }
}
