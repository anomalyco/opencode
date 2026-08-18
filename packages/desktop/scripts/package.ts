#!/usr/bin/env bun
import { buildWhisperToResources } from "./build-whisper"

export function resolveWhisperTarget(args: string[], hostPlatform = process.platform, hostArch = process.arch) {
  const platforms = new Set(
    args.flatMap((arg) => {
      if (arg === "-m" || arg === "--macos" || arg === "--mac" || arg.startsWith("--mac=")) return ["darwin"]
      if (arg === "-w" || arg === "--windows" || arg === "--win" || arg.startsWith("--win=")) return ["win32"]
      if (arg === "-l" || arg === "--linux" || arg.startsWith("--linux=")) return ["linux"]
      if (!/^-[mwl]{2,3}$/.test(arg)) return []
      return Array.from(arg.slice(1), (flag) => (flag === "m" ? "darwin" : flag === "w" ? "win32" : "linux"))
    }),
  )
  if (platforms.size > 1) throw new Error("Whisper runtime packaging supports only one platform at a time")
  const platform = platforms.values().next().value ?? hostPlatform
  if (platform !== hostPlatform) {
    throw new Error(`Whisper runtime cannot be packaged for ${platform} on ${hostPlatform}`)
  }
  if (args.some((arg) => /:(x64|arm64|ia32|armv7l|universal)$/.test(arg))) {
    throw new Error("Architecture-qualified Electron targets are not supported for Whisper runtime packaging")
  }
  if (args.includes("--ia32") || args.includes("--armv7l") || args.includes("--universal")) {
    throw new Error("Whisper runtime packaging supports only x64 and arm64")
  }
  const architectures = ["x64", "arm64"].filter((arch) => args.includes(`--${arch}`))
  if (architectures.length > 1) throw new Error("Whisper runtime packaging supports only one architecture at a time")
  const arch = architectures[0] ?? hostArch
  if (arch !== "arm64" && arch !== "x64") throw new Error(`Unsupported Whisper architecture: ${arch}`)
  if (platform === "linux" && arch !== hostArch) {
    throw new Error(`Whisper runtime cannot be cross-compiled for Linux ${arch} on ${hostArch}`)
  }
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  await buildWhisperToResources(resolveWhisperTarget(args))
  const child = Bun.spawn(["electron-builder", ...args, "--config", "electron-builder.config.ts"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await child.exited)
}
