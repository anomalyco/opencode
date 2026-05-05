// FORK: .md frontmatter 隐藏(D5 Obsidian 风 — 默认完全不渲染)2026-05-05
// YAML 语法错容错降级:strip 失败保留原文,不爆错不阻塞渲染。
//
// 仅匹配文件开头精确 "---\n ... \n---\n" 的成对模式;正文里的 --- 分割线不误判。
//
// 例子(全部 strip 后剩"正文"):
//   ---
//   title: 我的笔记
//   date: 2026-05-04
//   tags: [test]
//   ---
//   正文从这里开始

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

export function stripFrontmatter(text: string): string {
  if (!text) return text
  // 必须严格 "---" 开头(避免误判正文开头的 ---,或带 BOM 的文件)
  if (!text.startsWith("---")) return text
  // 精确匹配:必须紧接换行,且内部不能再次空行后没 closing ---
  const m = FRONTMATTER_RE.exec(text)
  if (!m) return text
  return text.slice(m[0].length)
}
