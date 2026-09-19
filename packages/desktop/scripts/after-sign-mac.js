// MUC Harness: muc 通道无 Developer ID 证书 —— 打包后做 ad-hoc 签名，
// 让下载副本至少具备有效签名（避免 macOS 报 "damaged"；正式分发仍需 Developer ID + notarization）。
import { execSync } from "node:child_process"

export default async function (context) {
  if (context.electronPlatformName !== "darwin") return
  if (process.env.OPENCODE_CHANNEL !== "muc") return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`MUC Harness: after-sign v2 (xattr+codesign) -> ${appPath}`)
  // 打包产物内的扩展属性（quarantine/FinderInfo）会让 codesign 拒签：
  // "resource fork, Finder information, or similar detritus not allowed"
  execSync(`xattr -cr "${appPath}"`, { stdio: "inherit" })
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" })
  } catch (e) {
    // 重试一次：先合并资源分叉再清理
    execSync(`dot_clean "${appPath}"`, { stdio: "inherit" })
    execSync(`xattr -cr "${appPath}"`, { stdio: "inherit" })
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" })
  }
  execSync(`codesign --verify --deep "${appPath}"`, { stdio: "inherit" })
  console.log(`MUC Harness: ad-hoc signed ${appPath}`)
}
