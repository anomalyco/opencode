// FORK: 聊天对话区右键"添加到聊天窗口" — pure helpers,无 context 依赖,可单测
// 把 AI/user 消息气泡里选中的文字 + user 在 input panel 写的 follow-up 问题
// 拼成 markdown 引用块格式,塞回 composer 的 text part 让 user 继续编辑 / 发送。
// 2026-05-15 [feat: chat-selection-menu]

import type { ContentPart } from "@/context/prompt"

/**
 * 把选区文字 + user comment 拼成 markdown 引用 + 问题。
 * 每行选区前缀 "> ",问题接在后面空行。
 * - 选区空 + comment 空 → ""(调用方应该跳过 insert)
 * - 选区空 + comment 有 → 只 comment
 * - 选区有 + comment 空 → 只引用块
 * - 选区有 + comment 有 → 引用块 + 空行 + comment
 */
export function composeQuotedMarkdown(selection: string, comment: string): string {
  const normalizedSel = selection.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  const c = comment.trim()
  if (!normalizedSel) return c
  const quoted = normalizedSel.split("\n").map((line) => `> ${line}`).join("\n")
  return c ? `${quoted}\n\n${c}` : quoted
}

/**
 * 把新文本插入到 prompt 的 text part(末尾 text 段;无 text 段则追加新 text part)。
 * - 末尾 text 段内容非空 → 已有内容 + 空行 + 新文本
 * - 末尾 text 段内容空(初始 DEFAULT_PROMPT 或被清空过)→ 直接替换为新文本
 * - 无 text 段(理论上不可能,DEFAULT_PROMPT 保证有)→ 追加新 text part
 */
export function insertTextIntoPrompt(prompt: readonly ContentPart[], text: string): ContentPart[] {
  if (!text) return [...prompt]
  const result: ContentPart[] = prompt.map((p) => ({ ...p }) as ContentPart)
  let lastTextIdx = -1
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].type === "text") {
      lastTextIdx = i
      break
    }
  }
  if (lastTextIdx >= 0) {
    const tp = result[lastTextIdx] as Extract<ContentPart, { type: "text" }>
    const existing = tp.content
    const next = existing.trim() ? `${existing}\n\n${text}` : text
    result[lastTextIdx] = { ...tp, content: next }
  } else {
    result.push({ type: "text", content: text, start: 0, end: 0 })
  }
  return result
}
