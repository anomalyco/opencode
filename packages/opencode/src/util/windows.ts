import * as os from "os"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export namespace WindowsUtils {
  /**
   * Check if we're running on Windows
   */
  export function isWindows(): boolean {
    return process.platform === "win32"
  }

  /**
   * Safely open a URL in the default browser on Windows, avoiding antivirus issues
   * Falls back to multiple methods if one fails
   */
  export async function openUrl(url: string): Promise<{ success: boolean; method?: string; error?: string }> {
    if (!isWindows()) {
      throw new Error("This function is Windows-specific")
    }

    const methods = [
      // Method 1: Use start command directly (least likely to trigger antivirus)
      {
        name: "start",
        command: `start "" "${url}"`,
      },
      // Method 2: Use rundll32 with shell32.dll
      {
        name: "rundll32",
        command: `rundll32 url.dll,FileProtocolHandler "${url}"`,
      },
      // Method 3: Try explorer
      {
        name: "explorer",
        command: `explorer "${url}"`,
      },
    ]

    for (const method of methods) {
      try {
        await execAsync(method.command, { timeout: 5000 })
        return { success: true, method: method.name }
      } catch (error) {
        // Continue to next method
        continue
      }
    }

    return {
      success: false,
      error: "All browser opening methods failed - this may be due to antivirus software blocking command execution",
    }
  }

  /**
   * Get user-friendly instructions for manually opening URLs when automatic opening fails
   */
  export function getManualOpenInstructions(url: string): string[] {
    return [
      "⚠️  Automatic browser opening failed (possibly due to antivirus software)",
      "",
      "Please manually open your browser and go to:",
      `   ${url}`,
      "",
      "💡 Tips to avoid this issue:",
      "   • Add opencode to your antivirus exclusions",
      "   • Use Windows Defender instead of third-party antivirus",
      "   • Temporarily disable real-time protection during authentication",
    ]
  }

  /**
   * Check if PowerShell is available and not blocked by antivirus
   */
  export async function isPowerShellAvailable(): Promise<boolean> {
    try {
      await execAsync("powershell -Command Get-Host", { timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get system information that might help with troubleshooting
   */
  export function getSystemInfo(): {
    platform: string
    release: string
    arch: string
    powershellAvailable?: boolean
  } {
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    }
  }
}
