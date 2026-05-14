// FORK: 多选拖动从 file-tree 到聊天 — pure helper,无 context 依赖,便于单测
// file-tree 多选拖动写 `application/x-deskfox-paths` MIME = JSON[abs paths](file-tree-dnd 内部 move 用 abs)
// 这里把它转成项目根下的相对路径列表(@-mention 期望 rel)。
// 边界:JSON 损坏 / 非数组 / 路径不在 root 下 / 路径含 Win 反斜杠 / 非字符串条目 全部容错。
// 2026-05-15 [feat: file-tree-multi-drag-to-chat]

export function parseMultiPathDropPaths(json: string | null | undefined, root: string | undefined): string[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const abs of parsed) {
    if (typeof abs !== "string" || !abs) continue
    out.push(absToRelPath(abs, root))
  }
  return out
}

function absToRelPath(abs: string, root: string | undefined): string {
  const normAbs = abs.replace(/\\/g, "/")
  if (!root) return normAbs
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (normAbs === normRoot) return ""
  if (normAbs.startsWith(normRoot + "/")) return normAbs.slice(normRoot.length + 1)
  // abs 不在 root 下(罕见,跨盘符 / 外部拖入),原样返回(LLM 拿完整路径)
  return normAbs
}
