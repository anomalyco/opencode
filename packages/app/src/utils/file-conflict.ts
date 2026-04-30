// [fork-only] 同名冲突自动后缀算法
// 参考 Windows 资源管理器:report.txt → report-1.txt → report-2.txt ...
//
// v2(2026-04-27):整体下沉到 Rust 端 `next_available_path` Tauri 命令,
// 一次往返 + OS 原生 Path normalize,避免 JS 端 `/` vs `\` 拼接歧义导致 exists 误判。

import { invoke } from "@tauri-apps/api/core"

/** 把文件名拆成 base + ext,目录或无扩展名时 ext = ""(给可能复用此逻辑的 JS 调用方,与 Rust 端 split_name_ext 同语义) */
export function splitNameExt(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf(".")
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: "" }
  return { base: name.slice(0, idx), ext: name.slice(idx) }
}

/**
 * 在 targetDir 下找一个不冲突的目标路径:
 * - 先试 sourceName 本身
 * - 冲突则 base-1, base-2, ... 直到找到空位(上限 1000,Rust 端实现)
 *
 * 全部交给 Tauri `next_available_path` 命令处理,JS 端不算 path,避免 `/`/`\` 混淆。
 */
export async function computeAvailableTarget(targetDirAbs: string, sourceName: string): Promise<string> {
  return await invoke<string>("next_available_path", { dir: targetDirAbs, name: sourceName })
}
