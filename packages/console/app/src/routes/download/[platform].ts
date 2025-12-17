import { APIEvent } from "@solidjs/start";

const assetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "opencode-desktop-darwin-aarch64.dmg",
  "windows-x64-nsis": "opencode-desktop-windows-x64.exe",
  "linux-x64-deb": "opencode-desktop-linux-amd64.deb",
  "linux-x64-rpm": "opencode-desktop-linux-x86_64.rpm"
}

export async function GET({ params: { platform } }: APIEvent) {
  const assetName = assetNames[platform];
  if(!assetName) return new Response("Not Found", { status: 404 });

  return await fetch(`https://github.com/sst/opencode/releases/latest/download/${assetName}`, {
    cf: {
      cacheTtl: 60 * 60 * 24,
      cacheEverything: true,
    }
  } as any)
}
