/**
 * ============================================================================
 * 文件名：ignore.ts
 * 所属包：packages/opencode/src/file
 * ============================================================================
 *
 * 文件作用：
 * 文件忽略规则模块。定义默认的文件和目录忽略模式，
 * 用于过滤不需要扫描的文件（如 node_modules、.git 等）。
 *
 * 主要功能：
 * - FOLDERS：默认忽略的目录列表
 * - FILES：默认忽略的文件 Glob 模式
 * - PATTERNS：所有忽略模式
 * - match(filepath, opts?)：检查文件路径是否匹配忽略规则
 *
 * 依赖关系：
 * - node:path：路径处理（sep 路径分隔符）
 *
 * 导出内容：
 * - FileIgnore namespace：文件忽略规则命名空间
 *   - FOLDERS：默认忽略的目录集合
 *   - FILES：默认忽略的文件模式
 *   - PATTERNS：所有忽略模式数组
 *   - match()：匹配函数
 *
 * 忽略规则包括：
 * - 依赖目录：node_modules、bower_components、vendor 等
 * - 构建输出：dist、build、out 等
 * - IDE 配置：.vscode、.idea 等
 * - VCS 目录：.git、.svn、.hg 等
 * - 临时文件：*.swp、*.swo、.DS_Store 等
 * - 日志文件：logs/**、*.log 等
 * - 测试输出：coverage/**、.nyc_output/** 等
 *
 * @package opencode
 * @module file/ignore
 */

// 导入路径分隔符
import { sep } from "node:path"

/**
 * 文件忽略规则命名空间
 *
 * 定义默认的文件和目录忽略规则。
 */
export namespace FileIgnore {
  /**
   * 默认忽略的目录集合
   *
   * 这些目录通常包含自动生成的内容或依赖项，
   * 不需要在代码搜索中扫描。
   */
  const FOLDERS = new Set([
    // Node.js 相关
    "node_modules",
    "bower_components",
    ".pnpm-store",
    // 依赖目录
    "vendor",
    ".npm",
    // 构建输出
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    // 版本控制
    ".git",
    ".svn",
    ".hg",
    // IDE 配置
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    // 其他
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    // Python 相关
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  /**
   * 默认忽略的文件 Glob 模式
   *
   * 临时文件、日志、测试输出等。
   */
  const FILES = [
    // Vim 交换文件
    "**/*.swp",
    "**/*.swo",

    // Python 字节码
    "**/*.pyc",

    // OS 文件
    "**/.DS_Store",
    "**/Thumbs.db",

    // 日志和临时文件
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // 覆盖率和测试输出
    "**/coverage/**",
    "**/.nyc_output/**",
  ]

  // 将文件模式编译为 Glob 对象
  const FILE_GLOBS = FILES.map((p) => new Bun.Glob(p))

  /**
   * 所有忽略模式
   *
   * 包含目录名和文件 Glob 模式。
   */
  export const PATTERNS = [...FILES, ...FOLDERS]

  /**
   * 检查文件路径是否匹配忽略规则
   *
   * @param filepath - 文件路径
   * @param opts - 可选配置
   *   - extra：额外的 Glob 模式
   *   - whitelist：白名单 Glob 模式（优先匹配）
   * @returns 是否应该忽略该文件
   *
   * 匹配逻辑：
   * 1. 先检查白名单，匹配则不忽略
   * 2. 检查路径中的目录是否在 FOLDERS 中
   * 3. 检查文件路径是否匹配任何 Glob 模式
   */
  export function match(
    filepath: string,
    opts?: {
      extra?: Bun.Glob[]
      whitelist?: Bun.Glob[]
    },
  ) {
    // 先检查白名单，白名单优先
    for (const glob of opts?.whitelist || []) {
      if (glob.match(filepath)) return false
    }

    // 检查路径中的每个目录段
    const parts = filepath.split(sep)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    // 检查 Glob 模式
    const extra = opts?.extra || []
    for (const glob of [...FILE_GLOBS, ...extra]) {
      if (glob.match(filepath)) return true
    }

    return false
  }
}
