/**
 * Permission checking for Computer Use (Phase 2).
 *
 * Checks macOS TCC permissions (screen recording + accessibility)
 * and provides user-friendly error messages when permissions are missing.
 */

import { callPythonHelper, isSupportedPlatform } from "./python-bridge.js"
import type { PermissionStatus } from "./types.js"

export interface PermissionCheckResult {
  supported: boolean
  accessibility: boolean
  screenRecording: boolean | null
  ready: boolean
  message?: string
}

/** Check if all required permissions are granted. */
export async function checkPermissions(): Promise<PermissionCheckResult> {
  if (!isSupportedPlatform()) {
    return {
      supported: false,
      accessibility: false,
      screenRecording: null,
      ready: false,
      message: "Computer Use is only supported on macOS.",
    }
  }

  try {
    const perms = await callPythonHelper<PermissionStatus>("check_permissions", {})
    const { accessibility, screenRecording } = perms

    const messages: string[] = []

    if (!accessibility) {
      messages.push(
        "Accessibility permission is required for mouse/keyboard control. " +
        "Go to System Settings > Privacy & Security > Accessibility and grant access.",
      )
    }

    if (screenRecording === false) {
      messages.push(
        "Screen Recording permission is required for screenshots. " +
        "Go to System Settings > Privacy & Security > Screen Recording and grant access.",
      )
    }

    if (screenRecording === null) {
      messages.push(
        "Unable to determine Screen Recording permission. Screenshots may trigger a macOS prompt.",
      )
    }

    const ready = accessibility && screenRecording !== false

    return {
      supported: true,
      accessibility,
      screenRecording,
      ready,
      message: messages.length > 0 ? messages.join("\n\n") : undefined,
    }
  } catch (err) {
    return {
      supported: true,
      accessibility: false,
      screenRecording: null,
      ready: false,
      message: `Permission check failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
