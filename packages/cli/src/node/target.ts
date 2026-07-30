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
  const fffPackage = `@ff-labs/fff-bin-${targetPlatform}-${targetArch}${targetPlatform === "linux" ? "-gnu" : ""}`
  const fffFfiPackage = `@yuuang/ffi-rs-${targetPlatform}-${targetArch}${targetPlatform === "linux" ? "-gnu" : targetPlatform === "win32" ? "-msvc" : ""}`

  return {
    platform: targetPlatform,
    arch: targetArch,
    nodePtyPackage,
    nodePtyEntryAsset: `${nodePtyPackage}/lib/index.js`,
    parcelWatcherPackage,
    parcelWatcherAsset: `${parcelWatcherPackage}/watcher.node`,
    fffPackage,
    fffAsset: `${fffPackage}/${targetPlatform === "darwin" ? "libfff_c.dylib" : targetPlatform === "win32" ? "fff_c.dll" : "libfff_c.so"}`,
    fffFfiPackage,
    fffFfiAsset: `${fffFfiPackage}/ffi-rs.${targetPlatform}-${targetArch}${targetPlatform === "linux" ? "-gnu" : targetPlatform === "win32" ? "-msvc" : ""}.node`,
  }
}

export const photonWasmAsset = "@silvia-odwyer/photon-node/photon_rs_bg.wasm"
export const shellParserWasmAssets = {
  runtime: "web-tree-sitter/tree-sitter.wasm",
  bash: "tree-sitter-bash/tree-sitter-bash.wasm",
  powershell: "tree-sitter-powershell/tree-sitter-powershell.wasm",
} as const
export const nodeExecArgv = ["--experimental-ffi", "--use-system-ca", "--disable-warning=ExperimentalWarning"] as const

export const attentionSoundAssets = [
  "@opencode-ai/ui/audio/bip-bop-01.mp3",
  "@opencode-ai/ui/audio/bip-bop-03.mp3",
  "@opencode-ai/ui/audio/staplebops-06.mp3",
  "@opencode-ai/ui/audio/nope-03.mp3",
  "@opencode-ai/ui/audio/yup-01.mp3",
] as const
