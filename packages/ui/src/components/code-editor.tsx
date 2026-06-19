import { createEffect, onCleanup, onMount } from "solid-js"
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import {
  bracketMatching,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { searchKeymap } from "@codemirror/search"
import { javascript } from "@codemirror/lang-javascript"
import { go } from "@codemirror/lang-go"
import { python } from "@codemirror/lang-python"
import { useTheme } from "../theme/context"
import { ocEditorTheme, ocLezerHighlight } from "../codemirror/theme"
import { editorLanguageToShikiLang, loadShikiForLang, shikiHighlightExtension } from "../codemirror/shiki-highlight"

export type CodeEditorLanguage = "typescript" | "go" | "python" | "plaintext"

export type CodeEditorProps = {
  value: string
  path?: string
  language?: CodeEditorLanguage
  readOnly?: boolean
  onChange?: (value: string) => void
  onSaveRequested?: () => void
  extensions?: Extension[]
  initialSelection?: { line: number; character: number }
  class?: string
}

// Marks a transaction as an external `value` sync so the update listener does
// not echo it back through `onChange`.
const externalSync = Annotation.define<boolean>()

function languageExtensionFor(language: CodeEditorLanguage): Extension | null {
  switch (language) {
    case "typescript":
      return javascript({ typescript: true, jsx: true })
    case "go":
      return go()
    case "python":
      return python()
    case "plaintext":
      return null
  }
}

function languageExtensionForPath(path: string): Extension | null {
  const lower = path.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf("."))
  switch (ext) {
    case ".ts":
    case ".tsx":
      return javascript({ typescript: true, jsx: true })
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return javascript({ jsx: true })
    case ".go":
      return go()
    case ".py":
    case ".pyi":
      return python()
    default:
      return null
  }
}

function resolveLanguage(props: CodeEditorProps): Extension | null {
  if (props.language) return languageExtensionFor(props.language)
  if (props.path) return languageExtensionForPath(props.path)
  return null
}

export function CodeEditor(props: CodeEditorProps) {
  let container!: HTMLDivElement
  let view: EditorView | undefined

  const theme = (() => {
    try {
      return useTheme()
    } catch {
      return undefined
    }
  })()

  const languageCompartment = new Compartment()
  const themeCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()
  const shikiCompartment = new Compartment()
  // Monotonic token so a stale async shiki load can't clobber a newer one.
  let shikiLoadToken = 0

  let changeTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleOnChange(value: string) {
    if (changeTimer) clearTimeout(changeTimer)
    changeTimer = setTimeout(() => {
      changeTimer = undefined
      props.onChange?.(value)
    }, 200)
  }

  function readOnlyExtension(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
  }

  onMount(() => {
    const updateListener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      if (u.transactions.some((tr) => tr.annotation(externalSync))) return
      scheduleOnChange(u.state.doc.toString())
    })

    const saveKeymap = keymap.of([
      {
        // Stops the browser's native save dialog while focused; the
        // authoritative save keybind is registered app-side.
        key: "Mod-s",
        run: () => {
          props.onSaveRequested?.()
          return true
        },
      },
    ])

    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of("  "),
      EditorState.tabSize.of(2),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      saveKeymap,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      updateListener,
    ]

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        ...baseExtensions,
        languageCompartment.of(resolveLanguage(props) ?? []),
        themeCompartment.of(ocEditorTheme()),
        shikiCompartment.of(ocLezerHighlight()),
        readOnlyCompartment.of(readOnlyExtension(props.readOnly ?? false)),
        ...(props.extensions ?? []),
      ],
    })

    view = new EditorView({ state, parent: container })

    const sel = props.initialSelection
    if (sel) {
      const doc = view.state.doc
      const lineNumber = Math.min(Math.max(sel.line + 1, 1), doc.lines)
      const line = doc.line(lineNumber)
      const offset = Math.min(line.from + Math.max(sel.character, 0), line.to)
      view.dispatch({ selection: { anchor: offset }, scrollIntoView: true })
      view.focus()
    }
  })

  createEffect(() => {
    const next = props.value
    const v = view
    if (!v) return
    const current = v.state.doc.toString()
    if (next === current) return
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: next },
      annotations: externalSync.of(true),
    })
  })

  createEffect(() => {
    const lang = resolveLanguage({ value: props.value, path: props.path, language: props.language })
    const v = view
    if (!v) return
    v.dispatch({ effects: languageCompartment.reconfigure(lang ?? []) })
  })

  createEffect(() => {
    const ro = props.readOnly ?? false
    const v = view
    if (!v) return
    v.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtension(ro)) })
  })

  createEffect(() => {
    if (!theme) return
    theme.themeId()
    const v = view
    if (!v) return
    v.dispatch({ effects: themeCompartment.reconfigure(ocEditorTheme()) })
  })

  createEffect(() => {
    const lang = editorLanguageToShikiLang(props.language, props.path)
    theme?.themeId()
    const token = ++shikiLoadToken

    if (!lang) {
      const v = view
      if (v) v.dispatch({ effects: shikiCompartment.reconfigure(ocLezerHighlight()) })
      return
    }

    void loadShikiForLang(lang)
      .then((highlighter) => {
        if (token !== shikiLoadToken) return
        const v = view
        if (!v) return
        if (!highlighter) {
          v.dispatch({ effects: shikiCompartment.reconfigure(ocLezerHighlight()) })
          return
        }
        v.dispatch({ effects: shikiCompartment.reconfigure(shikiHighlightExtension(highlighter, lang)) })
      })
      .catch(() => {
        if (token !== shikiLoadToken) return
        view?.dispatch({ effects: shikiCompartment.reconfigure(ocLezerHighlight()) })
      })
  })

  onCleanup(() => {
    if (changeTimer) clearTimeout(changeTimer)
    view?.destroy()
    view = undefined
  })

  return <div data-component="code-editor" class={props.class} ref={container} style={{ height: "100%" }} />
}
