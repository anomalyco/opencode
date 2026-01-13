/**
 * ============================================================================
 * 文件名：types.ts
 * 所属包：packages/console/app/src/routes/download
 * ============================================================================
 *
 * 文件作用：
 * 下载平台类型定义。定义支持的平台和包格式的类型。
 *
 * 主要功能：
 * - 定义 DownloadPlatform 类型联合类型
 * - 类型安全的平台标识符
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - DownloadPlatform：下载平台类型
 *
 * 支持的平台：
 * - macOS (Apple Silicon): darwin-aarch64-dmg
 * - macOS (Intel): darwin-x64-dmg
 * - Windows (x64): windows-x64-nsis
 * - Linux (Debian): linux-x64-deb
 * - Linux (RPM): linux-x64-rpm
 * - Linux (AppImage): linux-x64-appimage
 *
 * @package console.app
 * @module download/types
 */

/**
 * 下载平台类型
 *
 * 定义所有支持的桌面应用程序平台和包格式。
 *
 * 格式：{操作系统}-{架构}-{包格式}
 *
 * 平台说明：
 * - darwin：macOS 操作系统
 *   - aarch64：ARM64 架构（Apple Silicon，如 M1/M2）
 *   - x64：x86_64 架构（Intel）
 *   - dmg：macOS 磁盘映像格式
 *
 * - windows：Windows 操作系统
 *   - x64：x86_64 架构（64 位）
 *   - nsis：Nullsoft Scriptable Install System（Windows 安装程序）
 *
 * - linux：Linux 操作系统
 *   - x64：x86_64 架构（64 位）
 *   - deb：Debian 包格式（用于 Debian、Ubuntu 等）
 *   - rpm：RPM 包格式（用于 Fedora、RHEL 等）
 *   - appimage：AppImage 格式（通用 Linux 应用格式）
 */
export type DownloadPlatform =
  // macOS Apple Silicon (.dmg)
  | `darwin-${"x64" | "aarch64"}-dmg`
  // Windows x64 (.exe installer)
  | "windows-x64-nsis"
  // Linux x64 (多种包格式)
  | `linux-x64-${"deb" | "rpm" | "appimage"}`
