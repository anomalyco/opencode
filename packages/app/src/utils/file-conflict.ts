// [fork-only] 同名冲突自动后缀算法
// 参考 Windows 资源管理器:report.txt → report-1.txt → report-2.txt ...
//
// 不依赖现有 utils,自带最小路径处理(避免 file-tree.tsx 内部那套被外部依赖)。

import { invoke } from "@tauri-apps/api/core"

function trimTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "")
}

function joinAbs(parent: string, name: string): string {
  return `${trimTrailingSep(parent)}/${name}`
}

/** 把文件名拆成 base + ext,目录或无扩展名时 ext = "" */
export function splitNameExt(name: string): { base: string; ext: string } {
  // 仅在最后一个 . 之后切;开头 . 不算扩展名(.gitignore)
  const idx = name.lastIndexOf(".")
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: "" }
  return { base: name.slice(0, idx), ext: name.slice(idx) }
}

/**
 * 在 targetDir 下找一个不冲突的目标路径:
 * - 先试 sourceName 本身
 * - 冲突则 base-1, base-2, ... 直到找到空位(上限 1000)
 *
 * 检查存在用 Tauri 命令 `exists_path`(commit #1 同时新加)。
 * 返回完整目标绝对路径。
 */
export async function computeAvailableTarget(
  targetDirAbs: string,
  sourceName: string,
  options?: { existsCheck?: (path: string) => Promise<boolean> },
): Promise<string> {
  const exists = options?.existsCheck ?? ((p: string) => invoke<boolean>("exists_path", { path: p }))

  const initial = joinAbs(targetDirAbs, sourceName)
  if (!(await exists(initial))) return initial

  const { base, ext } = splitNameExt(sourceName)
  for (let i = 1; i <= 1000; i++) {
    const candidate = joinAbs(targetDirAbs, `${base}-${i}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`无法找到可用名称: ${sourceName}(${targetDirAbs} 下已有 1000+ 同名变体)`)
}
