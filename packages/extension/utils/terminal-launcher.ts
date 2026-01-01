/**
 * Terminal Launcher Utility
 * Launches terminal with commands using platform-specific protocols
 */

export type Platform = "windows" | "macos" | "linux" | "unknown"

/**
 * Detect the user's operating system
 */
export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()

  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  if (ua.includes("linux")) return "linux"

  return "unknown"
}

/**
 * Get the command to start OpenCode server
 */
export function getStartCommand(port: number = 4096): string {
  return `opencode serve --port ${port}`
}

/**
 * Get the command to start OpenCode in background (platform-specific)
 */
export function getBackgroundStartCommand(port: number = 4096): { command: string; shell: string } {
  const platform = detectPlatform()

  if (platform === "windows") {
    return {
      command: `Start-Process -WindowStyle Hidden opencode -ArgumentList "serve","--port","${port}"`,
      shell: "PowerShell",
    }
  }

  // macOS / Linux / WSL
  return {
    command: `nohup opencode serve --port ${port} > /tmp/opencode.log 2>&1 &`,
    shell: "Terminal",
  }
}

/**
 * Launch Windows Terminal with a command using ms-terminal:// protocol
 * https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments?tabs=windows
 */
export async function launchWindowsTerminal(command: string): Promise<boolean> {
  try {
    // URL encode the command for the protocol
    const encodedCommand = encodeURIComponent(command)

    // ms-terminal:// protocol format (Chrome often prefers the triple slash for custom schemes)
    const terminalUrl = `ms-terminal:///?cmdline=${encodedCommand}`

    console.log("[Eidorail] Launching Windows Terminal:", terminalUrl)

    // Try multiple approaches for browser extension context

    // Approach 1: Use chrome.tabs.update to navigate current tab (triggers protocol)
    if (typeof chrome !== "undefined" && chrome.tabs) {
      try {
        // Create a new tab with the protocol URL - this triggers the handler
        await chrome.tabs.create({ url: terminalUrl, active: false })
        // Close the tab after a short delay (it will be blank)
        return true
      } catch (e) {
        console.log("[Eidorail] chrome.tabs approach failed:", e)
      }
    }

    // Approach 2: window.open (may work in some contexts)
    const win = window.open(terminalUrl, "_blank")
    if (win) {
      setTimeout(() => win.close(), 100)
      return true
    }

    // Approach 3: Anchor click fallback
    const link = document.createElement("a")
    link.href = terminalUrl
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    return true
  } catch (error) {
    console.error("[Eidorail] Failed to launch Windows Terminal:", error)
    return false
  }
}

/**
 * Attempt to launch terminal with OpenCode start command
 * Returns true if protocol was triggered, false if fallback needed
 */
export async function launchOpenCodeInTerminal(
  port: number = 4096,
): Promise<{ launched: boolean; platform: Platform }> {
  const platform = detectPlatform()
  const command = getStartCommand(port)

  if (platform === "windows") {
    const launched = await launchWindowsTerminal(command)
    return { launched, platform }
  }

  // For macOS/Linux, we can't auto-launch terminal
  // Return false to show copy command UI
  return { launched: false, platform }
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
