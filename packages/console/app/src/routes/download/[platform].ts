import { APIEvent } from "@solidjs/start"
import { DownloadPlatform } from "./types"

const assetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "ohmycode-desktop-darwin-aarch64.dmg",
  "darwin-x64-dmg": "ohmycode-desktop-darwin-x64.dmg",
  "windows-x64-nsis": "ohmycode-desktop-windows-x64.exe",
  "linux-x64-deb": "ohmycode-desktop-linux-amd64.deb",
  "linux-x64-appimage": "ohmycode-desktop-linux-amd64.AppImage",
  "linux-x64-rpm": "ohmycode-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

const legacyAssetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "opencode-desktop-darwin-aarch64.dmg",
  "darwin-x64-dmg": "opencode-desktop-darwin-x64.dmg",
  "windows-x64-nsis": "opencode-desktop-windows-x64.exe",
  "linux-x64-deb": "opencode-desktop-linux-amd64.deb",
  "linux-x64-appimage": "opencode-desktop-linux-amd64.AppImage",
  "linux-x64-rpm": "opencode-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

// Doing this on the server lets us preserve the original name for platforms we don't care to rename for
const downloadNames: Record<string, string> = {
  "darwin-aarch64-dmg": "OhMyCode Desktop.dmg",
  "darwin-x64-dmg": "OhMyCode Desktop.dmg",
  "windows-x64-nsis": "OhMyCode Desktop Installer.exe",
} satisfies { [K in DownloadPlatform]?: string }

export async function GET({ params: { platform } }: APIEvent) {
  const assetName = assetNames[platform]
  if (!assetName) return new Response("Not Found", { status: 404 })

  let resp = await fetch(`https://github.com/anomalyco/ohmycode/releases/latest/download/${assetName}`, {
    cf: {
      // in case gh releases has rate limits
      cacheTtl: 60 * 5,
      cacheEverything: true,
    },
  } as any)

  if (!resp.ok) {
    const legacyAssetName = legacyAssetNames[platform]
    if (legacyAssetName) {
      resp = await fetch(`https://github.com/anomalyco/opencode/releases/latest/download/${legacyAssetName}`, {
        cf: {
          cacheTtl: 60 * 5,
          cacheEverything: true,
        },
      } as any)
    }
  }

  const downloadName = downloadNames[platform]

  const headers = new Headers(resp.headers)
  if (downloadName) headers.set("content-disposition", `attachment; filename="${downloadName}"`)

  return new Response(resp.body, { ...resp, headers })
}
