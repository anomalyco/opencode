/**
 * ============================================================================
 * 文件名：[platform].ts
 * 所属包：packages/console/app/src/routes/download
 * ============================================================================
 *
 * 文件作用：
 * 下载代理路由。从 GitHub Releases 代理桌面应用下载请求。
 *
 * 主要功能：
 * - 将平台标识符映射到 GitHub Release 资产文件名
 * - 从 GitHub Releases 下载文件并返回给用户
 * - 为特定平台设置友好的下载文件名
 * - 使用 Cloudflare 缓存减少 GitHub API 请求
 *
 * 依赖关系：
 * - @solidjs/start：API 事件类型
 * - ./types：DownloadPlatform 类型
 *
 * 导出内容：
 * - GET：处理 GET 请求，代理文件下载
 *
 * 路由：
 * - GET /download/{platform} → 代理下载对应平台的桌面应用
 *
 * 平台映射：
 * - darwin-aarch64-dmg → opencode-desktop-darwin-aarch64.dmg
 * - darwin-x64-dmg → opencode-desktop-darwin-x64.dmg
 * - windows-x64-nsis → opencode-desktop-windows-x64.exe
 * - linux-x64-deb → opencode-desktop-linux-amd64.deb
 * - linux-x64-rpm → opencode-desktop-linux-x86_64.rpm
 * - linux-x64-appimage → opencode-desktop-linux-amd64.AppImage
 *
 * Cloudflare 缓存策略：
 * - 缓存时间：24 小时
 * - 缓存所有内容：是
 * - 目的：避免 GitHub Releases 速率限制
 *
 * @package console.app
 * @module download/proxy
 */

// 导入 API 事件类型
import { APIEvent } from "@solidjs/start"

// 导入下载平台类型
import { DownloadPlatform } from "./types"

/**
 * GitHub Release 资产文件名映射
 *
 * 将平台标识符映射到 GitHub Releases 中的实际资产文件名。
 *
 * 映射规则：
 * - darwin-{arch}-dmg → opencode-desktop-darwin-{arch}.dmg
 * - windows-x64-nsis → opencode-desktop-windows-x64.exe
 * - linux-x64-deb → opencode-desktop-linux-amd64.deb（使用 amd64 而非 x64）
 * - linux-x64-rpm → opencode-desktop-linux-x86_64.rpm（使用 x86_64 而非 x64）
 * - linux-x64-appimage → opencode-desktop-linux-amd64.AppImage
 */
const assetNames: Record<string, string> = {
  // macOS ARM64 (Apple Silicon)
  "darwin-aarch64-dmg": "opencode-desktop-darwin-aarch64.dmg",
  // macOS x64 (Intel)
  "darwin-x64-dmg": "opencode-desktop-darwin-x64.dmg",
  // Windows x64
  "windows-x64-nsis": "opencode-desktop-windows-x64.exe",
  // Linux Debian 包
  "linux-x64-deb": "opencode-desktop-linux-amd64.deb",
  // Linux AppImage
  "linux-x64-appimage": "opencode-desktop-linux-amd64.AppImage",
  // Linux RPM 包
  "linux-x64-rpm": "opencode-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

/**
 * 用户友好的下载文件名映射
 *
 * 为特定平台设置更友好的下载文件名。
 * 对于未列出的平台，使用原始 GitHub 资产文件名。
 *
 * 友好文件名：
 * - macOS：OpenCode Desktop.dmg（统一 Apple Silicon 和 Intel）
 * - Windows：OpenCode Desktop Installer.exe
 * - Linux：使用原始文件名（因为包格式不同）
 */
const downloadNames: Record<string, string> = {
  // macOS ARM64 友好名称
  "darwin-aarch64-dmg": "OpenCode Desktop.dmg",
  // macOS x64 友好名称
  "darwin-x64-dmg": "OpenCode Desktop.dmg",
  // Windows 友好名称
  "windows-x64-nsis": "OpenCode Desktop Installer.exe",
} satisfies { [K in DownloadPlatform]?: string }

/**
 * 下载代理路由处理器
 *
 * 处理桌面应用下载请求：
 * 1. 验证平台标识符
 * 2. 获取对应的 GitHub 资产文件名
 * 3. 从 GitHub Releases 下载文件
 * 4. 设置友好的下载文件名（如果可用）
 * 5. 返回文件内容给用户
 *
 * @param event.params.platform - 平台标识符
 * @returns 文件下载响应或 404 错误
 *
 * @example
 * 请求 GET /download/darwin-aarch64-dmg
 *
 * 处理流程：
 * 1. 查找 assetNames["darwin-aarch64-dmg"] → "opencode-desktop-darwin-aarch64.dmg"
 * 2. 从 GitHub 下载：https://github.com/anomalyco/opencode/releases/latest/download/opencode-desktop-darwin-aarch64.dmg
 * 3. 设置下载文件名为 "OpenCode Desktop.dmg"
 * 4. 返回文件内容
 *
 * Cloudflare 缓存配置：
 * - cacheTtl: 86400 秒（24 小时）
 * - cacheEverything: true（缓存所有响应）
 * - 目的：避免 GitHub Releases 速率限制
 */
export async function GET({ params: { platform } }: APIEvent) {
  // 获取平台对应的 GitHub 资产文件名
  const assetName = assetNames[platform]
  // 如果平台不存在，返回 404
  if (!assetName) return new Response("Not Found", { status: 404 })

  // 从 GitHub Releases 下载文件
  const resp = await fetch(`https://github.com/anomalyco/opencode/releases/latest/download/${assetName}`, {
    // Cloudflare 缓存配置
    cf: {
      // 缓存 24 小时，避免 GitHub Releases 速率限制
      cacheTtl: 60 * 60 * 24,
      // 缓存所有内容
      cacheEverything: true,
    },
  } as any)

  // 获取友好下载文件名（如果存在）
  const downloadName = downloadNames[platform]

  // 复制响应头
  const headers = new Headers(resp.headers)
  // 如果有友好文件名，设置 Content-Disposition 头
  if (downloadName) headers.set("content-disposition", `attachment; filename="${downloadName}"`)

  // 返回文件内容
  return new Response(resp.body, { ...resp, headers })
}
