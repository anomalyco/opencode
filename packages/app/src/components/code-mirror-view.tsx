import { onCleanup, onMount, createEffect } from "solid-js"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { defaultHighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language"

type Props = {
  value: string
  language?: LanguageSupport
  onChange?: (value: string) => void
  // FORK: 上层注入语言/场景专用 extensions(如 markdown 列表续延 / 拖图 / 表格)2026-05-05
  extraExtensions?: Extension[]
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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      // FORK: extraExtensions 在 defaultKeymap 之前,自定义 keymap 优先 2026-05-05
      ...(props.extraExtensions ?? []),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) props.onChange?.(u.state.doc.toString())
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
