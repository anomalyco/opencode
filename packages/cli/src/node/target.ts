const platforms = ["darwin", "linux", "win32"] as const

export type NodeTarget = ReturnType<typeof nodeTarget>

export function nodeTarget(platform: string, arch: string) {
  if (!platforms.includes(platform as (typeof platforms)[number]) || (arch !== "arm64" && arch !== "x64")) {
    throw new Error(`Unsupported Node executable target: ${platform}-${arch}`)
  }

  const targetPlatform = platform as (typeof platforms)[number]
  const targetArch = arch as "arm64" | "x64"
  const nodePtyPackage = `@lydell/node-pty-${targetPlatform}-${targetArch}`
  const parcelWatcherPackage = `@parcel/watcher-${targetPlatform}-${targetArch}${targetPlatform === "linux" ? "-glibc" : ""}`

  return {
    platform: targetPlatform,
    arch: targetArch,
    nodePtyPackage,
    nodePtyEntryAsset: `${nodePtyPackage}/lib/index.js`,
    parcelWatcherPackage,
    parcelWatcherAsset: `${parcelWatcherPackage}/watcher.node`,
  }
}

export const photonWasmAsset = "@silvia-odwyer/photon-node/photon_rs_bg.wasm"
export const nodeExecArgv = ["--experimental-ffi", "--use-system-ca", "--disable-warning=ExperimentalWarning"] as const

export const attentionSoundAssets = [
  "@opencode-ai/ui/audio/bip-bop-01.mp3",
  "@opencode-ai/ui/audio/bip-bop-03.mp3",
  "@opencode-ai/ui/audio/staplebops-06.mp3",
  "@opencode-ai/ui/audio/nope-03.mp3",
  "@opencode-ai/ui/audio/yup-01.mp3",
] as const
