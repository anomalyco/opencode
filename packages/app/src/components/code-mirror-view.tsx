import { onCleanup, onMount, createEffect } from "solid-js"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { defaultHighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language"

export type CursorInfo = {
  line: number
  col: number
  selLength: number
}

type Props = {
  value: string
  language?: LanguageSupport
  onChange?: (value: string) => void
  // FORK: 上层注入语言/场景专用 extensions(如 markdown 列表续延 / 拖图 / 表格)2026-05-05
  extraExtensions?: Extension[]
  // FORK: md-editing-iter-2 — 光标 / 选区变化回调,用于状态栏行/列号 2026-05-09
  onCursorChange?: (info: CursorInfo) => void
}

export default function CodeMirrorView(props: Props) {
  let parent: HTMLDivElement | undefined
  let view: EditorView | undefined

  onMount(() => {
    if (!parent) return
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      // md-editing-iter-3 矫正 ⑤(2026-05-25):去掉 { fallback: true } — CM6 fallback 语义是
      // "仅当无其他 highlighter 时才用",一旦 markdownSyntaxHighlight 注册,default 整个 bail out
      // 导致 fenced code block 内 JS/TS/Python/SQL 等语言 keyword/string/number tag 拿不到着色。
      // 平级共存:CM 按 tag 逐个 resolve,markdown spec 匹配 heading/strong/link 等,
      //          代码块内部语言 tag 走 default(无冲突,各管各的 tag 集)
      syntaxHighlighting(defaultHighlightStyle),
      // FORK: md-editing-iter-2 — 长行软换行,避免水平滚动 2026-05-09
      EditorView.lineWrapping,
      // FORK: md-editing-iter-2 — drawSelection 让多行选区底色完整连贯(行尾空白也绘) 2026-05-09
      drawSelection(),
      // FORK: extraExtensions 在 defaultKeymap 之前,自定义 keymap 优先 2026-05-05
      ...(props.extraExtensions ?? []),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) props.onChange?.(u.state.doc.toString())
        // FORK: md-editing-iter-2 — 上报光标 / 选区状态给上层状态栏 2026-05-09
        if (props.onCursorChange && (u.docChanged || u.selectionSet)) {
          const sel = u.state.selection.main
          const lineObj = u.state.doc.lineAt(sel.head)
          props.onCursorChange({
            line: lineObj.number,
            col: sel.head - lineObj.from + 1,
            selLength: sel.to - sel.from,
          })
        }
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "Menlo, Consolas, monospace" },
      }),
    ]
    if (props.language) extensions.push(props.language)

    view = new EditorView({
      state: EditorState.create({ doc: props.value, extensions }),
      parent,
    })
    // FORK: md-editing-iter-2 — mount 后主动回调一次光标位置,初始化状态栏 2026-05-09
    if (props.onCursorChange && view) {
      const sel = view.state.selection.main
      const lineObj = view.state.doc.lineAt(sel.head)
      props.onCursorChange({
        line: lineObj.number,
        col: sel.head - lineObj.from + 1,
        selLength: sel.to - sel.from,
      })
    }
  })

  onCleanup(() => {
    view?.destroy()
    view = undefined
  })

  createEffect(() => {
    const v = props.value
    if (view && view.state.doc.toString() !== v) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
    }
  })

  return <div ref={parent} class="w-full h-full" style={{ "min-height": "300px" }} />
}
