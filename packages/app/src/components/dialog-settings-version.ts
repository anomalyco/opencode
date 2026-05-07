// FORK: dialog-settings 版本牌纯计算 helper — 抽出来便于 unit 测试 2026-05-07
// 由 dialog-settings.tsx 引用渲染左下角的 "DeskFox for <Platform>" + "v<version>"。
// installer 版本来源:packages/branding/installer-versions.json(由 bump 脚本同步)。

import installerVersions from "@opencode-ai/branding/installer-versions.json"

export type PlatformOS = "macos" | "windows" | "linux" | undefined

/** 把 platform.os 映射成显示用的平台名(行业惯例大小写)。
 *  - undefined / 未知 OS 返空串(渲染时 fallback "DeskFox" 不带 for)
 */
export function getPlatformLabel(os: PlatformOS): string {
  if (os === "macos") return "macOS"
  if (os === "windows") return "Windows"
  if (os === "linux") return "Linux"
  return ""
}

/** 拼第一行文案 — `DeskFox for <Platform>` 或 `DeskFox`(无平台名时) */
export function formatAppName(os: PlatformOS): string {
  const label = getPlatformLabel(os)
  return label ? `DeskFox for ${label}` : "DeskFox"
}

/** 选 installer 版本号(按 platform.os 选 JSON key)。
 *  - 未知 OS / web 模式 → fallback 到 pkgVersion(上游 desktop/package.json)
 *  - pkgVersion undefined(极端 case)→ 返 "unknown"(防 UI 显示 "vundefined")
 */
export function getInstallerVersion(os: PlatformOS, pkgVersion: string | undefined): string {
  if (os === "macos") return installerVersions.macos
  if (os === "windows") return installerVersions.windows
  return pkgVersion ?? "unknown"
}
