const nativeLibraries = {
  darwin: "libopentui.dylib",
  linux: "libopentui.so",
  win32: "opentui.dll",
} as const

export type NodeTarget = ReturnType<typeof nodeTarget>

export function nodeTarget(platform: string, arch: string) {
  if (!(platform in nativeLibraries) || (arch !== "arm64" && arch !== "x64")) {
    throw new Error(`Unsupported Node executable target: ${platform}-${arch}`)
  }

  const targetPlatform = platform as keyof typeof nativeLibraries
  const targetArch = arch as "arm64" | "x64"
  const opentuiNativePackage = `@opentui/core-${targetPlatform}-${targetArch}`
  const nodePtyPackage = `@lydell/node-pty-${targetPlatform}-${targetArch}`
  const parcelWatcherPackage = `@parcel/watcher-${targetPlatform}-${targetArch}${targetPlatform === "linux" ? "-glibc" : ""}`

  return {
    platform: targetPlatform,
    arch: targetArch,
    opentuiNativePackage,
    opentuiNativeAsset: `${opentuiNativePackage}/${nativeLibraries[targetPlatform]}`,
    nodePtyPackage,
    nodePtyEntryAsset: `${nodePtyPackage}/lib/index.js`,
    parcelWatcherPackage,
    parcelWatcherAsset: `${parcelWatcherPackage}/watcher.node`,
  }
}

const target = nodeTarget(process.platform, process.arch)

export const opentuiNativePackage = target.opentuiNativePackage
export const opentuiNativeAsset = target.opentuiNativeAsset
export const opentuiParserWorkerAsset = "@opentui/core/parser.worker.js"
export const webTreeSitterWasmAsset = "web-tree-sitter/tree-sitter.wasm"
export const photonWasmAsset = "@silvia-odwyer/photon-node/photon_rs_bg.wasm"
export const nodeExecArgv = ["--experimental-ffi", "--use-system-ca", "--disable-warning=ExperimentalWarning"] as const

export const opentuiParserAssets = [
  "@opentui/core/assets/javascript/highlights.scm",
  "@opentui/core/assets/javascript/tree-sitter-javascript.wasm",
  "@opentui/core/assets/typescript/highlights.scm",
  "@opentui/core/assets/typescript/tree-sitter-typescript.wasm",
  "@opentui/core/assets/markdown/highlights.scm",
  "@opentui/core/assets/markdown/tree-sitter-markdown.wasm",
  "@opentui/core/assets/markdown/injections.scm",
  "@opentui/core/assets/markdown_inline/highlights.scm",
  "@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm",
  "@opentui/core/assets/zig/highlights.scm",
  "@opentui/core/assets/zig/tree-sitter-zig.wasm",
] as const

export const attentionSoundAssets = [
  "@opencode-ai/ui/audio/bip-bop-01.mp3",
  "@opencode-ai/ui/audio/bip-bop-03.mp3",
  "@opencode-ai/ui/audio/staplebops-06.mp3",
  "@opencode-ai/ui/audio/nope-03.mp3",
  "@opencode-ai/ui/audio/yup-01.mp3",
] as const
