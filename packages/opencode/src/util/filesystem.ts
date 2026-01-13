/**
 * ============================================================================
 * 文件名：filesystem.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 文件系统工具模块。提供路径处理、文件搜索等文件系统操作工具。
 *
 * 主要功能：
 * - normalizePath()：Windows 路径大小写规范化
 * - overlaps()：检查两个路径是否有重叠
 * - contains()：检查一个路径是否包含另一个
 * - findUp()：向上搜索文件/目录
 * - up()：向上搜索的生成器版本
 * - globUp()：向上搜索匹配通配符的文件
 *
 * 依赖关系：
 * - fs：文件系统模块（realpathSync）
 * - fs/promises：异步文件操作（exists）
 * - path：路径处理模块（dirname, join, relative）
 *
 * 导出内容：
 * - Filesystem namespace：文件系统命名空间
 *   - normalizePath(p)：规范化路径
 *   - overlaps(a, b)：检查路径重叠
 *   - contains(parent, child)：检查包含关系
 *   - findUp(target, start, stop)：向上搜索
 *   - up(options)：向上搜索生成器
 *   - globUp(pattern, start, stop)：向上搜索通配符
 *
 * 使用场景：
 * - LSP 路径规范化（Windows 大小写问题）
 * - 检查文件路径的包含关系
 * - 查找配置文件（如 .gitignore, package.json）
 * - 从当前目录向上搜索项目根目录
 *
 * 使用示例：
 * ```typescript
 * // Windows 路径规范化
 * const normalized = Filesystem.normalizePath("C:\\Users\\Docs")
 * // 返回实际的大小写（如 C:\Users\docs）
 *
 * // 检查路径重叠
 * Filesystem.overlaps("/home/user/project", "/home/user/project/src")
 * // true（src 是 project 的子目录）
 *
 * Filesystem.overlaps("/home/user/project", "/home/user/other")
 * // false（没有重叠）
 *
 * // 检查包含关系
 * Filesystem.contains("/home/user", "/home/user/docs")
 * // true
 *
 * // 向上搜索配置文件
 * const gitignore = await Filesystem.findUp(".gitignore", process.cwd())
 * // 返回所有找到的 .gitignore 文件路径
 *
 * // 使用生成器版本
 * for await (const file of Filesystem.up({
 *   targets: ["package.json", ".git"],
 *   start: process.cwd(),
 *   stop: "/",
 * })) {
 *   console.log("找到:", file)
 * }
 *
 * // 向上搜索通配符
 * const tsConfigs = await Filesystem.globUp("tsconfig.json", process.cwd())
 * // 返回所有找到的 tsconfig.json 文件
 * ```
 *
 * Windows 路径问题：
 * - Windows 文件系统不区分大小写
 * - 但路径字符串可能使用任意大小写
 * - LSP 服务器可能返回不同大小写的路径
 * - 使用 realpathSync.native 获取实际大小写
 *
 * 相对路径判断：
 * - relative() 返回以 ".." 开头的路径表示在外部
 * - 不以 ".." 开头表示在内部或相等
 *
 * @package opencode
 * @module util/filesystem
 */

// 导入文件系统模块
import { realpathSync } from "fs"

// 导入异步文件操作
import { exists } from "fs/promises"

// 导入路径处理模块
import { dirname, join, relative } from "path"

/**
 * 文件系统命名空间
 *
 * 提供文件系统相关的工具函数。
 */
export namespace Filesystem {
  /**
   * 在 Windows 上规范化路径大小写
   *
   * Windows 文件系统不区分大小写，但路径字符串可能有任意大小写。
   * LSP 服务器可能返回与我们发送的不同大小写的路径。
   * 此函数使用文件系统获取路径的实际大小写。
   *
   * @param p - 要规范化的路径
   * @returns 规范化后的路径
   *
   * 平台差异：
   * - Windows：使用 realpathSync.native 获取实际大小写
   * - 其他平台：返回原路径（大小写敏感）
   *
   * 错误处理：
   * - 如果路径不存在，返回原路径
   *
   * @example
   * ```typescript
   * // Windows
   * Filesystem.normalizePath("C:\\Users\\Docs")
   * // 可能返回 "C:\Users\docs"（实际大小写）
   *
   * // Linux
   * Filesystem.normalizePath("/home/user/docs")
   * // 返回 "/home/user/docs"（不变）
   * ```
   */
  export function normalizePath(p: string): string {
    // 非 Windows 平台直接返回原路径
    if (process.platform !== "win32") return p

    try {
      // 使用 realpathSync.native 获取实际路径
      // native 使用系统 API 而非 Node.js 的路径处理
      return realpathSync.native(p)
    } catch {
      // 如果路径不存在或出错，返回原路径
      return p
    }
  }

  /**
   * 检查两个路径是否有重叠
   *
   * 如果一个路径是另一个的祖先或后代，则认为有重叠。
   *
   * @param a - 第一个路径
   * @param b - 第二个路径
   * @returns 是否有重叠
   *
   * 判断逻辑：
   * - 计算 a 相对于 b 的路径
   * - 计算 b 相对于 a 的路径
   * - 如果任一相对路径不以 ".." 开头，则有重叠
   *
   * 重叠情况：
   * - 相同路径
   * - 一个是另一个的父目录
   * - 一个是另一个的子目录
   *
   * @example
   * ```typescript
   * Filesystem.overlaps("/home/user", "/home/user/docs")
   * // true（user 包含 docs）
   *
   * Filesystem.overlaps("/home/user", "/home/user")
   * // true（相同路径）
   *
   * Filesystem.overlaps("/home/user/docs", "/home/user")
   * // true（docs 是 user 的子目录）
   *
   * Filesystem.overlaps("/home/user", "/opt/project")
   * // false（没有重叠）
   * ```
   */
  export function overlaps(a: string, b: string) {
    // 计算 a 相对于 b 的路径
    const relA = relative(a, b)

    // 计算 b 相对于 a 的路径
    const relB = relative(b, a)

    /**
     * 如果任一相对路径不以 ".." 开头，则有重叠
     *
     * relative() 的返回值：
     * - 如果 b 在 a 内部，relA 不以 ".." 开头
     * - 如果 a 在 b 内部，relB 不以 ".." 开头
     * - 如果相同，两者都是空字符串
     * - 如果在外部，两者都以 ".." 开头
     */
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  /**
   * 检查一个路径是否包含另一个路径
   *
   * 判断 child 是否在 parent 内部或相等。
   *
   * @param parent - 父路径
   * @param child - 子路径
   * @returns child 是否在 parent 内部
   *
   * 判断逻辑：
   * - 计算 child 相对于 parent 的路径
   * - 如果不以 ".." 开头，说明 child 在 parent 内部
   *
   * @example
   * ```typescript
   * Filesystem.contains("/home/user", "/home/user/docs")
   * // true
   *
   * Filesystem.contains("/home/user", "/home/user")
   * // true（相等也算包含）
   *
   * Filesystem.contains("/home/user", "/opt/project")
   * // false
   *
   * Filesystem.contains("/home/user", "/home/user/../opt")
   * // false
   * ```
   */
  export function contains(parent: string, child: string) {
    // 计算相对路径，如果不以 ".." 开头则在内部
    return !relative(parent, child).startsWith("..")
  }

  /**
   * 向上搜索文件或目录
   *
   * 从 start 目录开始，向上搜索目标文件/目录，直到 stop 目录。
   *
   * @param target - 要搜索的文件名或目录名
   * @param start - 开始搜索的目录
   * @param stop - 停止搜索的目录（可选）
   * @returns Promise，解析为找到的所有路径数组
   *
   * 搜索过程：
   * 1. 从 start 目录开始
   * 2. 检查当前目录 + target 是否存在
   * 3. 如果存在，添加到结果列表
   * 4. 移动到父目录
   * 5. 重复 2-4，直到到达 stop 或根目录
   *
   * 使用场景：
   * - 查找项目根目录的配置文件
   * - 查找 .git 目录
   * - 查找 package.json
   *
   * @example
   * ```typescript
   * // 查找所有 .gitignore 文件
   * const gitignores = await Filesystem.findUp(
   *   ".gitignore",
   *   "/home/user/project/src"
   * )
   * // ["/home/user/project/.gitignore", "/home/user/.gitignore"]
   *
   * // 查找 package.json，在项目根目录停止
   * const packages = await Filesystem.findUp(
   *   "package.json",
   *   "/home/user/project/packages/core/src",
   *   "/home/user/project"
   * )
   * ```
   */
  export async function findUp(target: string, start: string, stop?: string) {
    // 当前搜索目录
    let current = start

    // 存储找到的路径
    const result = []

    // 向上搜索循环
    while (true) {
      // 构造搜索路径
      const search = join(current, target)

      // 检查路径是否存在（捕获错误，不存在返回 false）
      if (await exists(search).catch(() => false)) result.push(search)

      // 如果到达停止目录，退出
      if (stop === current) break

      // 获取父目录
      const parent = dirname(current)

      // 如果已到根目录，退出
      if (parent === current) break

      // 移动到父目录
      current = parent
    }

    // 返回所有找到的路径
    return result
  }

  /**
   * 向上搜索的生成器版本
   *
   * 与 findUp 类似，但使用异步生成器，可以逐个处理结果。
   *
   * @param options - 搜索选项
   * @returns 异步生成器，按从近到远的顺序产生路径
   *
   * 选项：
   * - targets：要搜索的文件/目录名数组
   * - start：开始搜索的目录
   * - stop：停止搜索的目录（可选）
   *
   * 生成器优势：
   * - 惰性求值，可以提前退出
   * - 节省内存，不需要存储所有结果
   * - 可以边搜索边处理
   *
   * @example
   * ```typescript
   * // 搜索多个文件
   * for await (const path of Filesystem.up({
   *   targets: ["package.json", "tsconfig.json", ".git"],
   *   start: process.cwd(),
   * })) {
   *   console.log("找到:", path)
   *   // 可以提前退出
   *   if (path.endsWith(".git")) break
   * }
   *
   * // 查找项目根目录
   * async function findProjectRoot(): Promise<string | undefined> {
   *   for await (const path of Filesystem.up({
   *     targets: ["package.json"],
   *     start: process.cwd(),
   *   })) {
   *     return dirname(path)  // 返回第一个找到的目录
   *   }
   * }
   * ```
   */
  export async function* up(options: {
    targets: string[]   // 要搜索的文件/目录名数组
    start: string        // 开始搜索的目录
    stop?: string        // 停止搜索的目录
  }) {
    // 解构选项
    const { targets, start, stop } = options

    // 当前搜索目录
    let current = start

    // 向上搜索循环
    while (true) {
      // 遍历所有目标
      for (const target of targets) {
        // 构造搜索路径
        const search = join(current, target)

        // 如果存在，产生该路径
        if (await exists(search).catch(() => false)) yield search
      }

      // 如果到达停止目录，退出
      if (stop === current) break

      // 获取父目录
      const parent = dirname(current)

      // 如果已到根目录，退出
      if (parent === current) break

      // 移动到父目录
      current = parent
    }
  }

  /**
   * 向上搜索匹配通配符的文件
   *
   * 从 start 目录开始，向上搜索匹配 glob 模式的文件。
   *
   * @param pattern - Glob 通配符模式（如 *.json, **/*.ts）
   * @param start - 开始搜索的目录
   * @param stop - 停止搜索的目录（可选）
   * @returns Promise，解析为找到的所有文件路径数组
   *
   * Glob 模式：
   * - *：匹配任意文件名
   * - **：匹配任意子目录
   * - ?：匹配单个字符
   *
   * 扫描选项：
   * - cwd：当前工作目录
   * - absolute：返回绝对路径
   * - onlyFiles：只返回文件
   * - followSymlinks：跟随符号链接
   * - dot：匹配点文件（如 .gitignore）
   *
   * @example
   * ```typescript
   * // 查找所有 package.json
   * const packages = await Filesystem.globUp(
   *   "package.json",
   *   "/home/user/project/src"
   * )
   *
   * // 查找所有 TypeScript 配置文件
   * const tsConfigs = await Filesystem.globUp(
   *   "tsconfig*.json",
   *   process.cwd()
   * )
   *
   * // 查找所有 .gitignore
   * const gitignores = await Filesystem.globUp(
   *   ".gitignore",
   *   "/home/user/project/src"
   * )
   * ```
   */
  export async function globUp(pattern: string, start: string, stop?: string) {
    // 当前搜索目录
    let current = start

    // 存储找到的路径
    const result = []

    // 向上搜索循环
    while (true) {
      try {
        // 创建 Glob 对象
        const glob = new Bun.Glob(pattern)

        // 扫描匹配的文件
        for await (const match of glob.scan({
          cwd: current,           // 当前工作目录
          absolute: true,         // 返回绝对路径
          onlyFiles: true,        // 只返回文件
          followSymlinks: true,   // 跟随符号链接
          dot: true,              // 匹配点文件
        })) {
          // 添加到结果
          result.push(match)
        }
      } catch {
        // 跳过无效的 glob 模式
      }

      // 如果到达停止目录，退出
      if (stop === current) break

      // 获取父目录
      const parent = dirname(current)

      // 如果已到根目录，退出
      if (parent === current) break

      // 移动到父目录
      current = parent
    }

    // 返回所有找到的路径
    return result
  }
}
