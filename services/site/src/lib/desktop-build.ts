import type { DownloadPlatform } from "~/routes/download/types"
import type { Platform } from "~/lib/user-agent"

// The desktop builds' files, and which one this computer needs, with no framework code, so the
// static pages' script finds the build too. lib/download.ts adds the visitor's OS.

export type OS = "macOS" | "Windows" | "Linux" | null

/** Phones and tablets can't install the desktop app. */
export function desktopOS(platform: Platform | undefined): OS {
  if (platform === "macos") return "macOS"
  if (platform === "windows") return "Windows"
  if (platform === "linux") return "Linux"
  return null
}

/** Each desktop build's file in the update API's release metadata. */
export const desktopAssets = {
  "darwin-aarch64-dmg": "opencode-desktop-mac-arm64.dmg",
  "darwin-x64-dmg": "opencode-desktop-mac-x64.dmg",
  "windows-aarch64-nsis": "opencode-desktop-win-arm64.exe",
  "windows-x64-nsis": "opencode-desktop-win-x64.exe",
  "linux-x64-deb": "opencode-desktop-linux-amd64.deb",
  "linux-aarch64-deb": "opencode-desktop-linux-arm64.deb",
  "linux-x64-rpm": "opencode-desktop-linux-x86_64.rpm",
  "linux-aarch64-rpm": "opencode-desktop-linux-aarch64.rpm",
  "linux-x64-appimage": "opencode-desktop-linux-x86_64.AppImage",
  "linux-aarch64-appimage": "opencode-desktop-linux-arm64.AppImage",
} as const satisfies Record<DownloadPlatform, string>

/**
 * The update API (services/update). Always production's: there is one release service, and it has
 * no route on dev.opencode.ai.
 */
export const updateApi = "https://opencode.ai/update/api"

/**
 * A desktop build's download: the update API answers it with a 302 to the file in the files bucket.
 * Absolute, so never pass it through `route()`.
 */
export function getDownloadHref(platform: DownloadPlatform, channel: "latest" | "beta" = "latest") {
  return `${updateApi}/${channel}/desktop/opencode/${desktopAssets[platform]}`
}

/**
 * The exact desktop build for this computer (on `os`), when the browser can tell: the Mac's chip (Chromium's
 * client hints, else the WebGL renderer in Safari and Firefox, whose user agent always says "Intel
 * Mac"), and the Windows build (ARM64 when the client hints say so, else x64). Nothing when it can't
 * tell (Linux .deb, .rpm or AppImage, an unknown Mac), so no list marks two builds as this computer.
 * Asked once per page.
 */
export function desktopBuild(os: OS) {
  const known = builds.get(os)
  if (known) return known
  const found = detectBuild(os)
  builds.set(os, found)
  return found
}

const builds = new Map<OS, Promise<DownloadPlatform | undefined>>()

async function detectBuild(os: OS): Promise<DownloadPlatform | undefined> {
  if (os === "Windows") return (await clientArchitecture()) === "arm" ? "windows-aarch64-nsis" : "windows-x64-nsis"
  if (os !== "macOS") return
  const architecture = await clientArchitecture()
  if (architecture === "arm") return "darwin-aarch64-dmg"
  if (architecture === "x86") return "darwin-x64-dmg"
  const renderer = webglRenderer()
  if (/apple (m\d|gpu)/i.test(renderer)) return "darwin-aarch64-dmg"
  if (/intel|amd|radeon/i.test(renderer)) return "darwin-x64-dmg"
  return
}

/**
 * The build a Download button starts: the exact build when known, else on an ARM64 Linux computer
 * the ARM64 .deb (getDownloadPlatform gives the x64 .deb to the rest).
 */
export async function desktopDownload(os: OS): Promise<DownloadPlatform | undefined> {
  const build = await desktopBuild(os)
  if (build || os !== "Linux") return build
  if ((await clientArchitecture()) === "arm" || /aarch64|arm64/i.test(navigator.platform)) return "linux-aarch64-deb"
  return
}

async function clientArchitecture() {
  const data = (
    navigator as Navigator & {
      userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> }
    }
  ).userAgentData
  if (!data) return
  return data
    .getHighEntropyValues(["architecture"])
    .then((values) => values.architecture)
    .catch(() => undefined)
}

function webglRenderer() {
  const gl = document.createElement("canvas").getContext("webgl")
  if (!gl) return ""
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "")
  // Browsers allow only a few live WebGL contexts per page: give this one back.
  gl.getExtension("WEBGL_lose_context")?.loseContext()
  return renderer
}
