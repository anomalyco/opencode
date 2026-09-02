import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  File,
  type FileContents,
  getSharedHighlighter,
  VirtualizedFile,
} from "@pierre/diffs"
import type { Editor } from "@pierre/diffs/edit"
import { checksum } from "@opencode-ai/util/encode"
import { onCleanup, onMount } from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { applyViewerScheme, getViewerHost, observeViewerScheme } from "../pierre/file-runtime"
import { acquireVirtualizer } from "../pierre/virtualizer"
import { getWorkerPool } from "../pierre/worker"

export type FileEditorProps = {
  /** Initial contents only. Remount to edit a different file or reset the document. */
  file: FileContents
  onChange: (contents: string) => void
  onError?: (error: unknown) => void
  onReady?: () => void
}

export function FileEditor(props: FileEditorProps) {
  let container!: HTMLDivElement

  onMount(() => {
    // Pierre writes edited contents back to this object during cleanup.
    const initial = { ...props.file, cacheKey: `${props.file.name}:${checksum(props.file.contents)}` }
    let disposed = false
    let file: File | undefined
    let editor: Editor<undefined> | undefined
    let virtual: ReturnType<typeof acquireVirtualizer>

    const cleanup = () => {
      editor?.cleanUp()
      editor = undefined
      file?.cleanUp()
      file = undefined
      virtual?.release()
      virtual = undefined
    }

    onCleanup(() => {
      disposed = true
      cleanup()
    })
    onCleanup(observeViewerScheme(() => getViewerHost(container)))

    void (async () => {
      const { Editor } = await import("@pierre/diffs/edit")
      if (disposed) return

      const highlighter = await getSharedHighlighter({
        themes: ["OpenCode"],
        langs: [],
        preferredHighlighter: "shiki-wasm",
      })
      if (disposed) return

      const defaults = createDefaultOptions<undefined>("unified")
      const color = document.createElement("span").style
      const options = {
        ...defaults,
        disableErrorHandling: true,
        // Pierre 1.3.6's native tokenizer skips Shiki's CSS-variable replacements.
        // Cover both native DOM styles and cached HTML without rewriting tokens on each edit.
        unsafeCSS:
          defaults.unsafeCSS +
          Object.entries(highlighter.getTheme("OpenCode").colorReplacements ?? {})
            .map(([placeholder, replacement]) => {
              color.color = placeholder
              return `[data-line] [data-char]:is([style*="color:${placeholder};" i], [style*="color: ${color.color};"]) { color: ${replacement} !important; }`
            })
            .join("\n"),
      }
      virtual = initial.contents.length > 500_000 ? acquireVirtualizer(container) : undefined
      file = virtual
        ? new VirtualizedFile(
            options,
            virtual.virtualizer,
            { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: 24, spacing: 0 },
            getWorkerPool(),
          )
        : new File(options, getWorkerPool())
      file.render({ file: initial, containerWrapper: container })
      applyViewerScheme(getViewerHost(container))
      editor = new Editor<undefined>({
        onChange: (value) => props.onChange(value.contents),
        onAttach: () => {
          if (!disposed) props.onReady?.()
        },
      })
      editor.edit(file)
    })().catch((error: unknown) => {
      if (disposed) return
      cleanup()
      props.onError?.(error)
    })
  })

  return (
    <div
      ref={container}
      data-component="file-editor"
      dir="ltr"
      style={styleVariables}
      class="relative min-w-0 select-text outline-none"
      // Native listeners stop shadow-retargeted shortcuts before document-level review navigation.
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
    />
  )
}
