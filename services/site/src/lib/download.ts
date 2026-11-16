import type { DownloadPlatform } from "~/routes/download/types"
import type { Key } from "~/i18n"
import { detectPlatform, requestPlatform } from "~/lib/platform"
import { desktopBuild, desktopDownload, desktopOS, type OS } from "~/lib/desktop-build"

export { desktopAssets, desktopOS, getDownloadHref, updateApi, type OS } from "~/lib/desktop-build"

/** The desktop OS once mounted (detectPlatform); null for phones, tablets and unknown systems. */
export function detectOS(): OS {
  if (typeof navigator === "undefined") return null
  return desktopOS(detectPlatform())
}

/** The desktop OS for the first render (requestPlatform), so the server and hydration agree. */
export function requestOS(): OS {
  return desktopOS(requestPlatform())
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

/** The exact desktop build for this computer, when the browser can tell (desktop-build.ts). */
export const detectDesktopBuild = () => desktopBuild(detectOS())

/** The build a Download button starts (desktop-build.ts). */
export const detectDesktopDownload = () => desktopDownload(detectOS())

/** The desktop builds, in order. */
export const desktopBuilds = [
  { platform: "macOS", label: "download.platform.macosAppleSilicon", id: "darwin-aarch64-dmg" },
  { platform: "macOS", label: "download.platform.macosIntel", id: "darwin-x64-dmg" },
  { platform: "Windows", label: "download.platform.windowsX64", id: "windows-x64-nsis" },
  { platform: "Windows", label: "download.platform.windowsArm64", id: "windows-aarch64-nsis" },
  { platform: "Linux", label: "download.platform.linuxDebX64", id: "linux-x64-deb" },
  { platform: "Linux", label: "download.platform.linuxDebArm64", id: "linux-aarch64-deb" },
  { platform: "Linux", label: "download.platform.linuxRpmX64", id: "linux-x64-rpm" },
  { platform: "Linux", label: "download.platform.linuxRpmArm64", id: "linux-aarch64-rpm" },
  { platform: "Linux", label: "download.platform.linuxAppImageX64", id: "linux-x64-appimage" },
  { platform: "Linux", label: "download.platform.linuxAppImageArm64", id: "linux-aarch64-appimage" },
] as const satisfies readonly { platform: string; label: Key; id: DownloadPlatform }[]

export { desktopInstall } from "~/lib/install-commands"
