import type { DownloadPlatform } from "~/routes/download/types"
import type { Key } from "~/i18n"
import { detectPlatform, requestPlatform, type Platform } from "~/lib/platform"

export type OS = "macOS" | "Windows" | "Linux" | null

/** The desktop OS once mounted (detectPlatform); null for phones, tablets and unknown systems. */
export function detectOS(): OS {
  if (typeof navigator === "undefined") return null
  return desktopOS(detectPlatform())
}

/** The desktop OS for the first render (requestPlatform), so the server and hydration agree. */
export function requestOS(): OS {
  return desktopOS(requestPlatform())
}

/** Phones and tablets can't install the desktop app. */
export function desktopOS(platform: Platform | undefined): OS {
  if (platform === "macos") return "macOS"
  if (platform === "windows") return "Windows"
  if (platform === "linux") return "Linux"
  return null
}

export function getDownloadPlatform(os: OS): DownloadPlatform {
  switch (os) {
    case "macOS":
      return "darwin-aarch64-dmg"
    case "Windows":
      return "windows-x64-nsis"
    case "Linux":
      return "linux-x64-deb"
    default:
      return "darwin-aarch64-dmg"
  }
}

/**
 * The exact desktop build for this computer, when the browser can tell: the Mac's chip (Chromium's
 * client hints, else the WebGL renderer in Safari and Firefox, whose user agent always says "Intel
 * Mac"), and the one Windows build. Nothing when it can't tell (Linux .deb or .rpm, an unknown Mac),
 * so no list marks two builds as this computer.
 */
export async function detectDesktopBuild(): Promise<DownloadPlatform | undefined> {
  const os = detectOS()
  if (os === "Windows") return "windows-x64-nsis"
  if (os !== "macOS") return
  const architecture = await clientArchitecture()
  if (architecture === "arm") return "darwin-aarch64-dmg"
  if (architecture === "x86") return "darwin-x64-dmg"
  const renderer = webglRenderer()
  if (/apple (m\d|gpu)/i.test(renderer)) return "darwin-aarch64-dmg"
  if (/intel|amd|radeon/i.test(renderer)) return "darwin-x64-dmg"
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
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "")
}

export function getDownloadHref(platform: DownloadPlatform, channel: "stable" | "beta" = "stable") {
  return `/download/${channel}/${platform}`
}

/** The desktop builds, in order. The .AppImage build stays out until it works. */
export const desktopBuilds = [
  { platform: "macOS", label: "download.platform.macosAppleSilicon", id: "darwin-aarch64-dmg" },
  { platform: "macOS", label: "download.platform.macosIntel", id: "darwin-x64-dmg" },
  { platform: "Windows", label: "download.platform.windowsX64", id: "windows-x64-nsis" },
  { platform: "Linux", label: "download.platform.linuxDeb", id: "linux-x64-deb" },
  { platform: "Linux", label: "download.platform.linuxRpm", id: "linux-x64-rpm" },
] as const satisfies readonly { platform: string; label: Key; id: DownloadPlatform }[]

export { desktopInstall } from "~/lib/install-commands"
