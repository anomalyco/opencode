// FORK: 聊天输入框焦点跟随 helper — 给"添加到聊天窗口"类入口收尾用 [feat: chat-input-focus-follow] 2026-05-21
//
// 背景:`ChatSelectionMenu.submitToChat()` 等入口把内容塞进 composer 后,焦点仍停在原视图(MD 预览 / 文件树),
// user 必须再点一次输入框才能继续打字。本 helper 提供"焦点 + 光标到末尾"的统一收尾。
//
// 实现:模块级 singleton ref + Selection API。
// - PromptInput 在 editorRef 回调里 register,unmount cleanup;同一时刻全局只有一个 chat input,session 切换自动覆盖。
// - 调用方负责完成 `prompt.set(...)`,然后调 `focusChatInput()`。光标位置由调用方通过 `prompt.set(next, promptLength(next))` 控制,
//   helper 仅在 contenteditable 上再做一次 caret-to-end 兜底(防止异步 render 与 focus 顺序竞争时光标落错位置)。

let chatInputRef: HTMLElement | null = null

export function registerChatInputRef(el: HTMLElement | null) {
  chatInputRef = el
}

export function unregisterChatInputRef(el: HTMLElement) {
  if (chatInputRef === el) chatInputRef = null
}

export function focusChatInput() {
  const el = chatInputRef
  if (!el) return
  el.focus()
  if (typeof window === "undefined") return
  const sel = window.getSelection()
  if (!sel) return
  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {
    // contenteditable 偶发 selection API 抛错(节点未挂载等),focus 已成功就够,光标位置兜底由调用方 prompt.set cursor 参数保证
  }
}
