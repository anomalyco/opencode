/**
 * Security Constants
 *
 * Platform-agnostic constants and macOS-specific values for protected mode.
 */

// ============================================================================
// Platform-Agnostic Constants
// ============================================================================

/** Name of the restricted system user created for protected mode */
export const RESTRICTED_USER_NAME = "opencode-agent"

/** Path to sudoers configuration file */
export const SUDOERS_FILE_PATH = "/etc/sudoers.d/opencode"

// ============================================================================
// Platform-Specific Constants
// ============================================================================

const MACOS_CONSTANTS = {
  UID_RANGE: { START: 32767, END: 32700, FALLBACK: 499 },
  GROUP_ID: 20,
  USER_HOME: "/var/empty",
  SHELL: "/bin/bash",
} as const

// Future Linux support:
// const LINUX_CONSTANTS = {
//   UID_RANGE: { START: 1000, END: 65533, FALLBACK: 999 },
//   GROUP_ID: 100,
//   USER_HOME: "/nonexistent",
//   SHELL: "/bin/bash",
// } as const

/**
 * Platform-specific constants (runtime-detected)
 * Currently supports: macOS
 */
function getPlatformConstants() {
  switch (process.platform) {
    case "darwin":
      return MACOS_CONSTANTS
    // case "linux":
    //   return LINUX_CONSTANTS
    default:
      throw new Error(
        `Unsupported platform: ${process.platform}. Protected mode currently supports macOS. Linux support coming soon.`,
      )
  }
}

export const PLATFORM = getPlatformConstants()
export const MACOS = MACOS_CONSTANTS // For darwin.ts
