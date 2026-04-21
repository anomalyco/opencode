/**
 * 离线解析器路径解析工具
 *
 * 在离线环境中，parsers-config.ts 中定义的远程 URL 无法访问。
 * 此模块提供路径解析功能，将远程 URL 替换为本地文件路径，
 * 支持以下查找策略（按优先级）：
 *
 * 1. OPENCODE_PARSERS_DIR 环境变量
 * 2. Bun compile 内嵌路径 (bunfs)
 * 3. 与可执行文件同目录的 parsers/ 子目录
 * 4. 用户主目录下的 .opencode/parsers/
 */

import fs from "fs"
import path from "path"

/** 解析后的解析器目录路径，undefined 表示未找到 */
let _resolvedParsersDir: string | undefined

/**
 * 获取离线解析器缓存目录路径
 *
 * 仅在首次调用时执行文件系统探测，后续调用返回缓存结果。
 * 如需强制重新探测，传入 `force: true`。
 */
export function getParsersDir(force = false): string | undefined {
  if (!force && _resolvedParsersDir !== undefined) return _resolvedParsersDir

  // 1. 环境变量
  const envDir = process.env.OPENCODE_PARSERS_DIR
  if (envDir && fs.existsSync(envDir)) {
    _resolvedParsersDir = envDir
    return _resolvedParsersDir
  }

  // 2. Bun compile 内嵌路径 (Windows: B:/~BUN/root/, Unix: /$bunfs/root/)
  const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const bunfsParsers = path.join(bunfsRoot, "parsers")
  try {
    if (fs.existsSync(bunfsParsers)) {
      _resolvedParsersDir = bunfsParsers
      return _resolvedParsersDir
    }
  } catch {
    // bunfs 路径可能不可访问，忽略
  }

  // 3. 与可执行文件同目录的 parsers/ 子目录
  const exeDir = path.dirname(process.execPath)
  const localParsers = path.join(exeDir, "parsers")
  if (fs.existsSync(localParsers)) {
    _resolvedParsersDir = localParsers
    return _resolvedParsersDir
  }

  // 4. 当前工作目录下的 parsers/ 子目录
  const cwdParsers = path.join(process.cwd(), "parsers")
  if (fs.existsSync(cwdParsers)) {
    _resolvedParsersDir = cwdParsers
    return _resolvedParsersDir
  }

  _resolvedParsersDir = undefined
  return undefined
}

/**
 * 将远程 URL 映射为本地文件路径
 *
 * @param url   原始远程 URL（如 GitHub releases 链接）
 * @param filetype  语言类型（如 "python", "rust"）
 * @param kind  文件类型 "wasm" 或查询类型（如 "highlights", "locals"）
 * @returns 本地文件路径，如果文件不存在则返回原始 URL
 */
export function resolveParserUrl(url: string, filetype: string, kind: string): string {
  const parsersDir = getParsersDir()
  if (!parsersDir) return url

  const ext = kind === "wasm" ? ".wasm" : ".scm"
  const filename = kind === "wasm" ? path.basename(new URL(url).pathname) : `${kind}${ext}`
  const localPath = path.join(parsersDir, filetype, filename)

  if (fs.existsSync(localPath)) return localPath

  // 尝试不带版本号的 WASM 文件名匹配
  if (kind === "wasm") {
    const wasmFiles = fs.readdirSync(path.join(parsersDir, filetype)).catch(() => [] as string[])
    if (wasmFiles.length > 0) {
      const firstWasm = wasmFiles.find((f) => f.endsWith(".wasm"))
      if (firstWasm) return path.join(parsersDir, filetype, firstWasm)
    }
  }

  return url
}

/**
 * 将 parsers-config.ts 的解析器列表中的远程 URL 替换为本地路径
 *
 * 仅替换存在的本地文件，不存在的保持原始 URL 不变。
 * 此函数是幂等的，多次调用结果一致。
 */
export function resolveOfflineParsers(
  parsers: Array<{
    filetype: string
    wasm: string
    queries?: Record<string, string[]>
  }>,
): Array<{
  filetype: string
  wasm: string
  queries?: Record<string, string[]>
}> {
  const parsersDir = getParsersDir()
  if (!parsersDir) return parsers

  return parsers.map((parser) => {
    const localWasm = resolveParserUrl(parser.wasm, parser.filetype, "wasm")
    const localQueries = parser.queries
      ? Object.fromEntries(
          Object.entries(parser.queries).map(([queryType, urls]) => [
            queryType,
            urls.map((url) => resolveParserUrl(url, parser.filetype, queryType)),
          ]),
        )
      : undefined

    return {
      filetype: parser.filetype,
      wasm: localWasm,
      queries: localQueries,
    }
  })
}
