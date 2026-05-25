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
  /** PDF/office 来源文件路径(SelectionResult.sourceMeta.path)。
   *  非空 → submitToChat 用卡片(FileContextItem)而非 textarea blockquote;
   *  空 → 无 source 信息,走老路径 markdown 引用块。 */
  sourcePath: string
  /** 选区来源种类。"file" = PDF/office 文件,"chat" = 聊天区。决定卡片视觉 + LLM 模板。
   *  [feat: 聊天选区-卡片化-换行] 2026-05-25 */
  sourceKind: "file" | "chat" | ""
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
  sourcePath: "",
  sourceKind: "",
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

  // FORK: 右键 pointerdown snapshot — 防止 PDF 行间空白右键导致 selection collapse 后菜单不弹
  // [feat: office-选中加聊天] 2026-05-25 user QA 反馈
  //
  // 背景:WebView2(Chromium)默认行为是右键到非选区元素时把 caret 移到 click 位置 →
  // selection 被 collapse 成 0 长度。PDF textLayer 是绝对定位 spans,行间空白不属任何 span,
  // user 视觉上看 overlay 覆盖到这里(因为我们的视觉 bbox 算法 union 整行 rect),
  // 但 DOM 上不属选区,右键自动 collapse → 我的 getSelection 返回空 text → 菜单不可用。
  //
  // 修法:右键 pointerdown(在 mousedown 默认 collapse 之前)snapshot 一次选区,
  // contextmenu 时若 live selection 空且右键 client 坐标在 snapshot bbox 内,回退用 snapshot。
  let rightClickSnapshot:
    | { sel: SelectionResult; provider: SelectionProvider; bbox: DOMRect }
    | null = null
  let rightClickSnapshotTime = 0

  const onRightClickPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return
    const target = event.target as Element | null
    if (!target) return
    for (const provider of props.providers) {
      if (!provider.matches(target)) continue
      const sel = provider.getSelection(target)
      if (!sel || !sel.text.trim() || sel.rects.length === 0) {
        rightClickSnapshot = null
        return
      }
      let left = Infinity
      let right = -Infinity
      let top = Infinity
      let bottom = -Infinity
      for (const r of sel.rects) {
        if (r.left < left) left = r.left
        if (r.right > right) right = r.right
        if (r.top < top) top = r.top
        if (r.bottom > bottom) bottom = r.bottom
      }
      rightClickSnapshot = {
        sel,
        provider,
        bbox: new DOMRect(left, top, right - left, bottom - top),
      }
      rightClickSnapshotTime = Date.now()
      return
    }
    rightClickSnapshot = null
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

    // Fallback:live 空 + snapshot 新鲜 + 右键点击落在 snapshot bbox 内 → 用 snapshot
    // (右键在行间空白触发 collapse,但 user 视觉是在选区内,意图就是给现有选区开菜单)
    if (
      matched &&
      !matched.sel.text.trim() &&
      rightClickSnapshot &&
      Date.now() - rightClickSnapshotTime < 500
    ) {
      const bbox = rightClickSnapshot.bbox
      const inBbox =
        event.clientX >= bbox.left - 4 &&
        event.clientX <= bbox.right + 4 &&
        event.clientY >= bbox.top - 4 &&
        event.clientY <= bbox.bottom + 4
      if (inBbox && rightClickSnapshot.sel.text.trim()) {
        matched = { provider: rightClickSnapshot.provider, sel: rightClickSnapshot.sel }
        // 恢复 native selection(让 Ctrl+C 与视觉一致;TextLayerBuilder 的高亮也会重画)
        if (rightClickSnapshot.sel.range) {
          try {
            const ns = window.getSelection()
            if (ns) {
              ns.removeAllRanges()
              ns.addRange(rightClickSnapshot.sel.range)
            }
          } catch {
            // detached range / cross-document — 忽略,只用 snapshot 数据开菜单
          }
        }
      }
    }

    if (!matched) return // 不接管,继续走原生菜单(WebView2 / browser default)

    event.preventDefault()
    event.stopPropagation()

    applyHighlight(matched.sel)
    setComment("")
    // FORK: sourceKind 区分 chat / pdf-office;chat 走聊天引用卡片 + LLM 模板分流
    // [feat: 聊天选区-卡片化-换行] 2026-05-25
    const metaKind = matched.sel.sourceMeta?.kind
    const sourceKind: "chat" | "file" | "" =
      metaKind === "chat" ? "chat" : metaKind === "pdf-office" ? "file" : ""
    setMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      text: matched.sel.text,
      mode: "menu",
      partial: matched.sel.partial === true,
      provider: matched.provider,
      sourcePath: matched.sel.sourceMeta?.path ?? "",
      sourceKind,
    })
  }

  onMount(() => {
    if (typeof document === "undefined") return
    document.addEventListener("pointerdown", onRightClickPointerDown, true)
    document.addEventListener("contextmenu", handleContextMenu, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onRightClickPointerDown, true)
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
    if (!m.text.trim() && !c.trim()) return

    // FORK: PDF/office + chat 选区都走"卡片"路径(复用 FileContextItem + commentOrigin="quote"),
    // 由 kind 字段区分 LLM 模板(formatCommentNote 分流):
    //   - kind="file" (PDF/office) → "comment regarding this file of {path}" 模板
    //   - kind="chat" (聊天引用) → "user is quoting earlier in this conversation" 模板
    // 卡片 UI 也按 kind 分流(file 显文件名 + file icon / chat 显"聊天引用" + bubble icon)。
    // [feat: 聊天选区-卡片化-换行] 2026-05-25
    //
    // 关键:commentID 用 preview 的 hash 强制每次不同选区生成不同 key,
    // 否则 contextItemKey 算法在没 selection 行号的情况下会把同源多次选区认为同一项 dedup 掉。
    if (m.sourceKind === "file" || m.sourceKind === "chat") {
      // 空 comment 时给个默认占位,formatCommentNote 才会把 preview 段拼进去(没 comment 它返回空)
      const effectiveComment = c.trim() || "(see selected text)"
      let hash = 0
      for (let i = 0; i < m.text.length; i++) {
        hash = ((hash << 5) - hash + m.text.charCodeAt(i)) | 0
      }
      const commentID = `quote-${Math.abs(hash).toString(36)}-${Date.now().toString(36)}`
      prompt.context.add({
        type: "file",
        path: m.sourcePath,
        comment: effectiveComment,
        preview: m.text,
        commentID,
        commentOrigin: "quote",
        kind: m.sourceKind,
      })
      requestAnimationFrame(focusChatInput)
      showToast({
        variant: "success",
        title: c.trim() ? "已加入聊天(含问题)" : "已加入聊天",
      })
      return
    }

    // sourceKind 为空(理论上不该出现,Provider 必返 sourceMeta;留兜底走老路径)
    const composed = composeQuotedMarkdown(m.text, c)
    if (!composed) return
    const current = prompt.current()
    const next = insertTextIntoPrompt(current, composed)
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
                  // FORK: solid 蓝 + mix-blend-mode: multiply
                  // [feat: office-选中加聊天] 2026-05-25 user 反馈"正掌握"3 字底色比左右浅
                  // 根因:rgba alpha 跟下层 canvas pixels(黑文字 vs 白空白)乘出来颜色不均
                  // 修法:solid color + multiply 混合 — 黑×蓝=黑(文字保留),白×蓝=蓝(均匀蓝底)
                  // 视觉:跟 chat native 选区接近,字间均匀无浓淡变化
                  // 普通 alpha 0.55 — multiply 模式下原 PDF 里强调色文字(soffice 转出来非纯黑)
                  // 会被 multiply 揭露成不同 blue 色调,user 视觉感觉"忽深忽浅"。
                  // 改回 normal blend,稍高 alpha 把下层颜色变化压住
                  "background-color": "rgba(60, 120, 220, 0.55)",
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
