// FORK: 聊天对话区右键选区菜单 [feat: chat-selection-menu] 2026-05-15
//
// 在聊天对话区(message-timeline `[data-slot="session-turn-list"]`)选中文字后,右键弹自家 2 项菜单:
//   1. 添加到聊天窗口 → 切到输入面板让 user 写问题 → 提交把 "> 引用块\n\n问题" 塞进 composer 末尾 text part
//   2. 复制(Ctrl+C 提示)
// 无选区时两项都灰显(沿用 `menu-always-show-with-disabled` 哲学,UX 一致)。
//
// 跟 file-tabs.tsx 的 mdMenu 是两套独立 state,避免菜单串台。
// 选区不加 overlay 高亮(per user Q4 = A,保持系统默认蓝色选区即可)。

import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Portal } from "solid-js/web"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { composeQuotedMarkdown, insertTextIntoPrompt } from "./chat-selection-quote"
import { focusChatInput } from "@/utils/chat-input-focus"
import { promptLength } from "@/components/prompt-input/history"

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

type MenuMode = "menu" | "input"
type MenuState = { open: boolean; x: number; y: number; text: string; mode: MenuMode }
type HighlightRect = { left: number; top: number; width: number; height: number }

const CHAT_LOG_SELECTOR = '[data-slot="session-turn-list"]'

export function ChatSelectionMenu() {
  const prompt = usePrompt()
  const language = useLanguage()

  const [menu, setMenu] = createSignal<MenuState>({ open: false, x: 0, y: 0, text: "", mode: "menu" })
  const [comment, setComment] = createSignal("")

  // 选区红色覆盖层 — 跟 file-tabs.tsx `setSelectionHighlight` 同套路。
  // 原生选区在 textarea 拿焦点时会丢,自家 fixed div 兜底让 user 输入问题时仍能看到选了什么。
  // 颜色:Microsoft Fluent 系统红 #d13438 / 0.5 alpha,跟文件查看器视觉一致。
  const [highlightRects, setHighlightRects] = createSignal<HighlightRect[] | null>(null)

  const setSelectionHighlight = (range: Range | null) => {
    if (!range) {
      setHighlightRects(null)
      return
    }
    try {
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
      setHighlightRects(rects.length > 0 ? rects : null)
    } catch {
      setHighlightRects(null)
    }
  }

  // 滚动时清 overlay(rect 是 viewport 坐标,滚动后失效)
  createEffect(() => {
    if (!highlightRects()) return
    const onScroll = () => setHighlightRects(null)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => window.removeEventListener("scroll", onScroll, true))
  })

  const close = () => {
    setMenu((m) => (m.open ? { ...m, open: false } : m))
    setComment("")
    setSelectionHighlight(null)
    // 关菜单时清掉浏览器原生选区,UX 与文件查看器对齐
    if (typeof window !== "undefined") {
      try {
        window.getSelection()?.removeAllRanges()
      } catch {
        // ignore
      }
    }
  }

  const handleContextMenu = (event: MouseEvent) => {
    const target = event.target as Element | null
    if (!target) return
    // 仅在聊天 log 容器内右键时拦截;其他区(file tree / composer / file viewer)继续走原生
    if (!target.closest(CHAT_LOG_SELECTOR)) return

    event.preventDefault()
    event.stopPropagation()

    let text = ""
    let range: Range | null = null
    const sel = typeof window !== "undefined" ? window.getSelection() : null
    if (sel && sel.rangeCount > 0) {
      const s = sel.toString()
      if (s.trim()) {
        text = s
        range = sel.getRangeAt(0).cloneRange()
      }
    }

    // 设 overlay — input 模式 textarea 拿焦点会清掉原生选区,自家红色 div 兜底
    setSelectionHighlight(range)

    setComment("")
    setMenu({ open: true, x: event.clientX, y: event.clientY, text, mode: "menu" })
  }

  // 注:capture-phase + document-level,确保在 WebView2 弹原生菜单前 preventDefault
  onMount(() => {
    if (typeof document === "undefined") return
    document.addEventListener("contextmenu", handleContextMenu, true)
    onCleanup(() => {
      document.removeEventListener("contextmenu", handleContextMenu, true)
    })
  })

  // 点空白 / Esc 关菜单(与 file-tabs 同套路)
  createEffect(() => {
    if (!menu().open) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('[data-slot="chat-selection-menu"]')) return
      close()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("mousedown", onDocDown, true)
    document.addEventListener("keydown", onEsc, true)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocDown, true)
      document.removeEventListener("keydown", onEsc, true)
    })
  })

  const openInputPanel = () => {
    setMenu((m) => ({ ...m, mode: "input" }))
  }

  const copySelection = () => {
    const text = menu().text
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        // ignore — 复制失败 toast 也没必要,user 看着菜单消失就知道操作完成
      })
    }
    close()
  }

  const submitToChat = () => {
    const m = menu()
    const c = comment()
    close()
    const composed = composeQuotedMarkdown(m.text, c)
    if (!composed) return
    const current = prompt.current()
    const next = insertTextIntoPrompt(current, composed)
    // FORK: 光标到末尾 + focus chat input,user 可立刻继续打字 [feat: chat-input-focus-follow] 2026-05-21
    // 用 rAF 跟 prompt-input.tsx `applyHistoryPrompt` 同套路 — 等 store update 触发的 editor re-render 完再 focus
    prompt.set(next, promptLength(next))
    requestAnimationFrame(focusChatInput)
    showToast({
      variant: "success",
      title: c.trim() ? "已加入聊天输入框(含问题)" : "已加入聊天输入框",
    })
  }

  return (
    <>
      <Show when={highlightRects()}>
        <Portal mount={document.body}>
          <For each={highlightRects()!}>
            {(rect) => (
              <div
                class="fixed pointer-events-none z-40"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  "background-color": "rgba(209, 52, 56, 0.5)",
                }}
              />
            )}
          </For>
        </Portal>
      </Show>
      <Show when={menu().open}>
      <Portal mount={document.body}>
        <Switch>
          <Match when={menu().mode === "menu"}>
            <div
              data-slot="chat-selection-menu"
              class="fixed z-50 min-w-[180px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] py-1 text-sm"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <button
                class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                disabled={!menu().text.trim()}
                onClick={openInputPanel}
              >
                {language.t("fileViewer.menu.addToChat")}
              </button>
              <div class="my-1 border-t border-border-base" />
              <button
                class="w-full px-3 py-1.5 hover:bg-surface-base-hover flex justify-between items-center gap-6 disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                disabled={!menu().text.trim()}
                onClick={copySelection}
              >
                <span>{language.t("fileViewer.menu.copy")}</span>
                <span class="text-xs text-text-weak">Ctrl+C</span>
              </button>
            </div>
          </Match>
          <Match when={menu().mode === "input"}>
            <div
              data-slot="chat-selection-menu"
              class="fixed z-50 w-[360px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] p-3 text-sm flex flex-col gap-2"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <textarea
                ref={(el) => queueMicrotask(() => el.focus())}
                class="w-full min-h-[80px] rounded border border-border-base bg-background-base px-2 py-1.5 text-sm text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-text-interactive-base resize-y"
                placeholder={language.t("fileViewer.menu.input.placeholder")}
                value={comment()}
                onInput={(e) => setComment(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  if (!(e.ctrlKey || e.metaKey || (IS_MAC && e.altKey))) return
                  e.preventDefault()
                  submitToChat()
                }}
              />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-text-weak">
                  {language.t("fileViewer.menu.input.shortcutHint", {
                    shortcut: IS_MAC ? "Cmd/Opt+Enter" : "Ctrl+Enter",
                  })}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="text-xs px-2 py-1 rounded border border-border-base hover:bg-surface-base-hover"
                    onClick={close}
                  >
                    {language.t("common.cancel")}
                  </button>
                  <button
                    class="text-xs px-2 py-1 rounded border border-border-base bg-surface-base hover:bg-surface-base-hover"
                    onClick={submitToChat}
                  >
                    {language.t("fileViewer.menu.input.submit")}
                  </button>
                </div>
              </div>
            </div>
          </Match>
        </Switch>
      </Portal>
      </Show>
    </>
  )
}
