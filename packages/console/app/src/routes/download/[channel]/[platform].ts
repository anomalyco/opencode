import type { APIEvent } from "@solidjs/start/server"
import type { DownloadPlatform } from "../types"

const assetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "opencode-desktop-mac-arm64.dmg",
  "darwin-x64-dmg": "opencode-desktop-mac-x64.dmg",
  "windows-aarch64-nsis": "opencode-desktop-win-arm64.exe",
  "windows-x64-nsis": "opencode-desktop-win-x64.exe",
  "linux-x64-deb": "opencode-desktop-linux-amd64.deb",
  "linux-x64-appimage": "opencode-desktop-linux-x86_64.AppImage",
  "linux-x64-rpm": "opencode-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

export async function GET({ params: { platform, channel } }: APIEvent) {
  const assetName = assetNames[platform]
  if (!assetName) return new Response(null, { status: 404 })

  // `stable` is the old name for `latest` and what the download page linked to for months. Keep it as a permanent
  // alias: ~10% of /download/stable/* traffic (~45k requests a week, Oct 2026) comes from outside opencode.ai,
  // including bookmarks, other sites and curl/wget scripts.
  const release = await fetch(
    `https://opencode.ai/update/api/${channel === "stable" ? "latest" : encodeURIComponent(channel)}/desktop/opencode`,
  )
  if (!release.ok) return new Response(null, { status: release.status })
  const location = getAssetUrl(await release.json(), assetName)
  if (!location) return new Response(null, { status: 502 })
  return Response.redirect(location, 302)
}

function getAssetUrl(input: unknown, assetName: string) {
  if (!isRecord(input) || !isRecord(input.metadata) || !isRecord(input.metadata.files)) return
  const asset = input.metadata.files[assetName]
  if (!isRecord(asset) || typeof asset.url !== "string") return
  return asset.url
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
