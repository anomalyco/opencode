// FORK: 选区菜单统一 Host — Solid 组件,document-level capture 监听 contextmenu [feat: office-选中加聊天] 2026-05-24
//
// 设计要点:
// 1. Host 是 Solid 组件,根布局挂一次 — 跟 chat-selection-menu(2026-05-15)同套路。
// 2. Provider 路由 = first match wins。详 1-spec § 决策点 #2 / provider.ts JSDoc。
// 3. getSelection() 同步契约 — 右键瞬间菜单必须出来。async Provider(iframe/OCR)留 v3+ 自己做 loading 态。
// 4. 菜单 UI / 引用拼接 / focus / toast 永远只有一份 — 把"如何拿选区(每种格式不同)"和
//    "如何拼引用块/塞 composer(永远只有一种)"两个 concern 切开。
//
// 行为承继自 chat-selection-menu.tsx(258 行,Step 3 薄壳化):
// - menu / input 双模(右键先弹 2 项菜单 → 点"添加到聊天"切换到 textarea 让 user 写问题)
// - 红色 highlight overlay 兜底(textarea 拿焦点时原生选区会丢)
// - Esc / 点空白 / 提交 → 关菜单 + 清 overlay + 清原生选区
// - Ctrl/Cmd+Enter(Mac 加 Opt+Enter)提交
// - toast 通知"已加入聊天输入框 [+ 含问题]"

import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import {
  composeQuotedMarkdown,
  insertTextIntoPrompt,
} from "@/pages/session/chat-selection-quote"
import { focusChatInput } from "@/utils/chat-input-focus"
import { promptLength } from "@/components/prompt-input/history"
import type { SelectionProvider, SelectionResult } from "./provider"

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

type MenuMode = "menu" | "input"
type MenuState = {
  open: boolean
  x: number
  y: number
  text: string
  mode: MenuMode
  /** true 时 "添加到聊天" disabled — Step 4 跨页选区 toast 兜底用 */
  partial: boolean
  /** 接管本次右键的 Provider — 关菜单时调 clear() */
  provider: SelectionProvider | null
}

type HighlightRect = { left: number; top: number; width: number; height: number }

const INITIAL_MENU: MenuState = {
  open: false,
  x: 0,
  y: 0,
  text: "",
  mode: "menu",
  partial: false,
  provider: null,
}

export function ContextMenuHost(props: {
  providers: SelectionProvider[]
}): JSX.Element {
  const prompt = usePrompt()
  const language = useLanguage()

  const [menu, setMenu] = createSignal<MenuState>(INITIAL_MENU)
  const [comment, setComment] = createSignal("")
  const [highlightRects, setHighlightRects] = createSignal<HighlightRect[] | null>(null)

  const applyHighlight = (sel: SelectionResult | null) => {
    if (!sel || sel.rects.length === 0) {
      setHighlightRects(null)
      return
    }
    setHighlightRects(
      sel.rects.map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })),
    )
  }

  // 滚动时清 overlay(rect 是 viewport 坐标,滚动后失效)
  createEffect(() => {
    if (!highlightRects()) return
    const onScroll = () => setHighlightRects(null)
    window.addEventListener("scroll", onScroll, true)
    onCleanup(() => window.removeEventListener("scroll", onScroll, true))
  })

  // FORK: 拖拽中实时视觉 overlay — 仅对 pdf-viewer 区域生效
  // [feat: office-选中加聊天] 2026-05-25 user 反馈"视觉漏字仍看得见"
  //
  // 背景:Provider.getSelection 的视觉 bbox 算法已让 chat 收到完整 text + Host 红色 overlay
  // 在右键瞬间显示完整视觉,但**拖拽中** user 看到的仍是浏览器 native 蓝色高亮(线性,可能漏字)。
  // 本 effect 在 selectionchange 时**实时**调 Provider 重算 rects 更新 overlay,
  // 让 user 在拖拽过程中就看到完整视觉(red overlay 覆盖 native blue 漏掉的部分)。
  //
  // 限制:
  // - chat 区不接管(chat 走 message-part user-select:text,native 蓝色就是完整的,加 red overlay 反而干扰)
  // - menu open 时不更新(snapshot 模式,保持右键瞬间快照)
  onMount(() => {
    if (typeof document === "undefined") return
    const onSelectionChange = () => {
      // menu 打开时走 snapshot 模式,不动 overlay
      if (menu().open) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) {
        setHighlightRects(null)
        return
      }
      const range = sel.getRangeAt(0)
      const ancestor = range.commonAncestorContainer
      const targetEl =
        ancestor.nodeType === Node.ELEMENT_NODE
          ? (ancestor as Element)
          : ancestor.parentElement
      if (!targetEl) {
        setHighlightRects(null)
        return
      }
      // 只对 pdf-viewer 区域跑视觉算法 — chat 区让 native 自己显示蓝色
      if (!targetEl.closest('[data-slot="pdf-viewer"]')) {
        setHighlightRects(null)
        return
      }
      for (const provider of props.providers) {
        if (!provider.matches(targetEl)) continue
        const result = provider.getSelection(targetEl)
        if (result && result.rects.length > 0 && result.text.trim()) {
          applyHighlight(result)
          return
        }
      }
      setHighlightRects(null)
    }
    document.addEventListener("selectionchange", onSelectionChange)
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange))
  })

  const close = () => {
    const m = menu()
    if (!m.open) return
    m.provider?.clear()
    setMenu(INITIAL_MENU)
    setComment("")
    setHighlightRects(null)
  }

  const handleContextMenu = (event: MouseEvent) => {
    const target = event.target as Element | null
    if (!target) return

    // first match wins:按注册顺序遍历 providers
    let matched: { provider: SelectionProvider; sel: SelectionResult } | null = null
    for (const provider of props.providers) {
      if (!provider.matches(target)) continue
      const sel = provider.getSelection(target)
      if (!sel) continue
      matched = { provider, sel }
      break
    }
    if (!matched) return // 不接管,继续走原生菜单(WebView2 / browser default)

    event.preventDefault()
    event.stopPropagation()

    applyHighlight(matched.sel)
    setComment("")
    setMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      text: matched.sel.text,
      mode: "menu",
      partial: matched.sel.partial === true,
      provider: matched.provider,
    })
  }

  onMount(() => {
    if (typeof document === "undefined") return
    document.addEventListener("contextmenu", handleContextMenu, true)
    onCleanup(() => {
      document.removeEventListener("contextmenu", handleContextMenu, true)
    })
  })

  // 点空白 / Esc 关菜单
  createEffect(() => {
    if (!menu().open) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('[data-slot="context-menu-host"]')) return
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
        // 失败 toast 没必要,菜单消失即视觉反馈
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
    // 光标到末尾 + focus chat input,user 可立刻继续打字
    // rAF 跟 prompt-input.tsx applyHistoryPrompt 同套路 — 等 store update 触发的 editor re-render 完再 focus
    prompt.set(next, promptLength(next))
    requestAnimationFrame(focusChatInput)
    showToast({
      variant: "success",
      title: c.trim() ? "已加入聊天输入框(含问题)" : "已加入聊天输入框",
    })
  }

  // 接管标志:菜单"添加到聊天"是否可点。partial 选区(跨页)v1 disable + 提示分段。
  const canAddToChat = () => menu().text.trim() !== "" && !menu().partial

  return (
    <>
      <Show when={highlightRects()}>
        <Portal mount={document.body}>
          <For each={highlightRects()!}>
            {(rect) => (
              <div
                data-slot="selection-overlay-rect"
                class="fixed pointer-events-none z-40"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  // FORK: 单色统一 — 跟 chat 区 native 选区蓝同色调,user 反馈双色困惑
                  // [feat: office-选中加聊天] 2026-05-25
                  "background-color": "rgba(60, 120, 220, 0.4)",
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
                data-slot="context-menu-host"
                class="fixed z-50 min-w-[180px] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] py-1 text-sm"
                style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
              >
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-surface-base-hover disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!canAddToChat()}
                  title={menu().partial ? language.t("fileViewer.menu.crossPageHint") : undefined}
                  onClick={openInputPanel}
                >
                  {language.t("fileViewer.menu.addToChat")}
                </button>
                {/* 跨页选区提示 — partial 选区(PDF 跨页 textLayer 懒加载导致内容不全)
                    内联文字比 toast 不打扰,user 看到 disabled 按钮自然知道原因 */}
                <Show when={menu().partial}>
                  <div class="px-3 pb-1 pt-0.5 text-[11px] text-text-weak max-w-[260px]">
                    {language.t("fileViewer.menu.crossPageHint")}
                  </div>
                </Show>
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
                data-slot="context-menu-host"
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
                    // macOS Opt+Enter / Cmd+Enter,Win/Linux Ctrl+Enter
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
