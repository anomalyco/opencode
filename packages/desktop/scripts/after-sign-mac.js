// MUC Harness: muc 通道无 Developer ID 证书 —— 打包后做 ad-hoc 签名，
// 让下载副本至少具备有效签名（避免 macOS 报 "damaged"；正式分发仍需 Developer ID + notarization）。
import { execSync } from "node:child_process"

export default async function (context) {
  if (context.electronPlatformName !== "darwin") return
  if (process.env.OPENCODE_CHANNEL !== "muc") return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" })
  console.log(`MUC Harness: ad-hoc signed ${appPath}`)
}
