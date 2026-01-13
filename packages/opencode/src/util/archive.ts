/**
 * ============================================================================
 * 文件名：archive.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 压缩包解压工具模块。提供跨平台的 ZIP 文件解压功能。
 *
 * 主要功能：
 * - extractZip()：解压 ZIP 文件到目标目录
 * - 自动检测操作系统平台
 * - Windows 使用 PowerShell 的 Expand-Archive
 * - Unix 系统使用 unzip 命令
 *
 * 依赖关系：
 * - bun：Bun 运行时的 shell 命令功能（$ 模板标签）
 * - path：Node.js 路径处理模块
 *
 * 导出内容：
 * - Archive namespace：压缩包命名空间
 *   - extractZip(zipPath, destDir)：解压 ZIP 文件
 *
 * 使用场景：
 * - 下载 LSP 服务器后解压
 * - 解压插件包
 * - 解压发布包
 * - 任何需要解压 ZIP 文件的场景
 *
 * 使用示例：
 * ```typescript
 * // 解压 ZIP 文件
 * await Archive.extractZip(
 *   "/path/to/archive.zip",
 *   "/path/to/destination"
 * )
 *
 * // 在下载后解压
 * async function downloadAndExtract(url: string, dest: string) {
 *   const zipPath = await downloadFile(url)
 *   await Archive.extractZip(zipPath, dest)
 *   await fs.unlink(zipPath)
 * }
 * ```
 *
 * 平台差异：
 * - Windows：使用 PowerShell 的 Expand-Archive cmdlet
 * - Linux/macOS：使用系统的 unzip 命令
 *
 * PowerShell 参数：
 * - -NoProfile：不加载用户配置文件
 * - -NonInteractive：非交互模式
 * - -Command：执行指定的命令
 * - $global:ProgressPreference = 'SilentlyContinue'：禁用进度条
 * - -Force：覆盖已存在的文件
 *
 * unzip 参数：
 * - -o：覆盖已存在的文件
 * - -q：静默模式（不输出）
 * - -d：指定目标目录
 *
 * 注意事项：
 * - Windows 需要 PowerShell（通常默认安装）
 * - Unix 系统需要安装 unzip 命令
 * - 目标目录如果不存在会自动创建
 * - 已存在的文件会被覆盖
 *
 * @package opencode
 * @module util/archive
 */

// 导入 Bun 的 shell 命令执行器
import { $ } from "bun"

// 导入 Node.js 路径处理模块
import path from "path"

/**
 * 压缩包命名空间
 *
 * 提供跨平台的压缩包解压功能。
 */
export namespace Archive {
  /**
   * 解压 ZIP 文件到目标目录
   *
   * 根据操作系统平台自动选择合适的解压工具。
   *
   * @param zipPath - ZIP 文件的路径
   * @param destDir - 解压目标目录
   * @returns Promise，解压完成时 resolve
   *
   * 平台支持：
   * - Windows：PowerShell Expand-Archive
   * - Linux/macOS：unzip 命令
   *
   * 错误处理：
   * - .quiet() 会抑制输出，但错误仍会抛出异常
   * - 如果解压失败，Promise 会 reject
   *
   * @example
   * ```typescript
   * // 解压下载的 LSP 服务器
   * const zipFile = "/tmp/typescript-language-server.zip"
   * const destDir = "/path/to/lsp/bin"
   * await Archive.extractZip(zipFile, destDir)
   * ```
   */
  export async function extractZip(zipPath: string, destDir: string) {
    // 检查是否为 Windows 平台
    if (process.platform === "win32") {
      // 将路径转换为绝对路径（Windows 需要）
      const winZipPath = path.resolve(zipPath)
      const winDestDir = path.resolve(destDir)

      /**
       * 构造 PowerShell 命令
       *
       * $global:ProgressPreference = 'SilentlyContinue'
       * - 禁用 PowerShell 的蓝色进度条弹窗
       * - 进度条会导致控制台输出混乱
       *
       * Expand-Archive 参数：
       * - -Path：ZIP 文件路径
       * - -DestinationPath：目标目录
       * - -Force：覆盖已存在的文件
       */
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`

      // 执行 PowerShell 命令解压
      // -NoProfile：不加载用户配置文件
      // -NonInteractive：非交互模式
      // -Command：执行指定的命令
      // .quiet()：抑制输出（但不抑制错误）
      await $`powershell -NoProfile -NonInteractive -Command ${cmd}`.quiet()
    } else {
      /**
       * Unix 系统（Linux/macOS）使用 unzip 命令
       *
       * 参数说明：
       * - -o：覆盖已存在的文件（不提示）
       * - -q：静默模式（不输出详情）
       * - -d：指定解压目标目录
       */
      await $`unzip -o -q ${zipPath} -d ${destDir}`.quiet()
    }
  }
}
