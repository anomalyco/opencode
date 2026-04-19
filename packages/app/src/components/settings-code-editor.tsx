import { Component, Show, onMount, onCleanup, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { showToast } from "@opencode-ai/ui/toast"
import { formatServerError } from "@/utils/server-errors"
import { EditorView, basicSetup } from "codemirror"
import { EditorState, Compartment, type Extension } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { indentWithTab } from "@codemirror/commands"

interface SettingsCodeEditorProps {
  title: string
  extensions: Extension[]
  load: () => Promise<{ path: string; content: string } | undefined>
  save: (content: string) => Promise<{ content: string } | undefined>
  i18n: {
    saved: string
    savedDescription: string
    saveFailed: string
    save: string
    revert: string
    loading: string
    loadFailed: string
    initFailed: string
    unsaved: string
  }
}

const editorTheme = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--surface-stronger-non-alpha)",
        color: "var(--text-default)",
        position: "absolute",
        inset: "0",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: "var(--text-strong)",
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        lineHeight: "1.6",
      },
      ".cm-gutters": {
        backgroundColor: "var(--surface-stronger-non-alpha)",
        color: "var(--text-weak)",
        border: "none",
        borderRight: "1px solid var(--border-default)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--text-default)",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--text-default) 5%, transparent)",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--text-strong)",
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in srgb, var(--text-default) 15%, transparent)",
      },
      ".cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--text-default) 10%, transparent)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-matchingBracket": {
        backgroundColor: "color-mix(in srgb, var(--text-default) 15%, transparent)",
        color: "var(--text-strong)",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--surface-default)",
        color: "var(--text-weak)",
        border: "1px solid var(--border-default)",
      },
    },
    { dark },
  )

export const SettingsCodeEditor: Component<SettingsCodeEditorProps> = (props) => {
  const theme = useTheme()

  const [state, setState] = createStore({
    filePath: "",
    savedContent: "",
    currentContent: "",
    saving: false,
    error: "",
    loading: true,
  })

  let view: EditorView | undefined
  const themeCompartment = new Compartment()

  const isDirty = () => state.currentContent !== state.savedContent
  const isDark = createMemo(() => theme.mode() === "dark")

  function initEditor(el: HTMLDivElement) {
    view?.destroy()
    try {
      const saveKeymap = keymap.of([
        {
          key: "Mod-s",
          run: () => {
            if (!state.saving && isDirty()) void save()
            return true
          },
        },
      ])

      const editorState = EditorState.create({
        doc: state.currentContent,
        extensions: [
          basicSetup,
          ...props.extensions,
          keymap.of([indentWithTab]),
          saveKeymap,
          themeCompartment.of(editorTheme(isDark())),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setState("currentContent", update.state.doc.toString())
            }
          }),
        ],
      })

      view = new EditorView({ state: editorState, parent: el })
    } catch (e) {
      setState("error", e instanceof Error ? e.message : props.i18n.initFailed)
    }
  }

  async function load() {
    setState({ loading: true, error: "" })
    try {
      const result = await props.load()
      if (!result) {
        setState("error", props.i18n.loadFailed)
        return
      }
      setState({
        filePath: result.path,
        savedContent: result.content,
        currentContent: result.content,
      })
    } catch (e) {
      setState("error", formatServerError(e))
    } finally {
      setState("loading", false)
    }
  }

  async function save() {
    setState({ saving: true, error: "" })
    try {
      const result = await props.save(state.currentContent)
      if (result) {
        setState({
          savedContent: result.content,
          currentContent: result.content,
        })
        showToast({ title: props.i18n.saved, description: props.i18n.savedDescription })
      }
    } catch (e) {
      const message = formatServerError(e)
      setState("error", message)
      showToast({ title: props.i18n.saveFailed, description: message })
    } finally {
      setState("saving", false)
    }
  }

  function revert() {
    setState({ currentContent: state.savedContent, error: "" })
    if (view) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: state.savedContent,
        },
      })
    }
  }

  onMount(() => {
    load()
  })

  createEffect(() => {
    const dark = isDark()
    if (view) {
      view.dispatch({
        effects: themeCompartment.reconfigure(editorTheme(dark)),
      })
    }
  })

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden px-4 pb-4 sm:px-10 sm:pb-4">
      <div class="shrink-0 flex flex-col gap-1 pt-6 pb-4">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <Show when={state.filePath}>
          <span class="text-12-regular text-text-weak">
            {state.filePath}
          </span>
        </Show>
      </div>

      <Show
        when={!state.loading}
        fallback={<div class="flex-1 min-h-0 text-text-weak text-13-regular p-4">{props.i18n.loading}</div>}
      >
        <div
          role="textbox"
          aria-multiline="true"
          aria-label={props.title}
          class="flex-1 min-h-0 relative overflow-hidden rounded-lg border border-border-default"
          ref={(el) => {
            initEditor(el)
            onCleanup(() => view?.destroy())
          }}
        />
      </Show>

      <Show when={state.error}>
        <span role="alert" class="shrink-0 text-12-regular text-danger-default pt-2">{state.error}</span>
      </Show>

      <div class="shrink-0 flex items-center gap-2 pt-4">
        <Show when={isDirty()}>
          <span class="text-12-regular text-warning-default">{props.i18n.unsaved}</span>
        </Show>
        <div class="flex-1" />
        <Button
          size="small"
          variant="primary"
          disabled={!isDirty() || state.saving}
          onClick={save}
        >
          {props.i18n.save}
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={!isDirty()}
          onClick={revert}
        >
          {props.i18n.revert}
        </Button>
      </div>
    </div>
  )
}
