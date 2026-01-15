import { useRef, useEffect, useState } from 'react'
import { EditorView, keymap, highlightSpecialChars, drawSelection, rectangularSelection } from '@codemirror/view'
import { EditorState, Extension } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'

// Minimal basic setup
const basicExtensions = [
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
  ]),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
]

interface UseCodeMirrorOptions {
  value?: string
  onChange?: (value: string) => void
  onSave?: () => void
  language?: string
  readOnly?: boolean
  theme?: 'dark' | 'light'
}

// Get language extension based on file extension or MIME type
function getLanguageExtension(language?: string): Extension {
  if (!language) return []

  const lang = language.toLowerCase()

  // Map file extensions to CodeMirror language extensions
  if (lang.includes('javascript') || lang === 'js' || lang === 'jsx') {
    return javascript()
  }
  if (lang.includes('typescript') || lang === 'ts' || lang === 'tsx') {
    return javascript({ typescript: true })
  }
  if (lang === 'html' || lang === 'htm') {
    return html()
  }
  if (lang === 'css' || lang === 'scss' || lang === 'sass') {
    return css()
  }
  if (lang === 'json') {
    return json()
  }
  if (lang === 'md' || lang === 'markdown') {
    return markdown()
  }

  // Default to plain text
  return []
}

// Get language from file path
function getLanguageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  return extension || 'text'
}

export function useCodeMirror({
  value = '',
  onChange,
  onSave,
  language,
  readOnly = false,
  theme = 'dark',
}: UseCodeMirrorOptions) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!editorRef.current) return

    // Create keyboard shortcuts extension
    const keyBindings = EditorView.domEventHandlers({
      keydown: (event: KeyboardEvent) => {
        // Ctrl+S or Cmd+S to save
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault()
          onSave?.()
          return true
        }
        return false
      }
    })

    // Create update listener for onChange
    const updateListener = EditorView.updateListener.of((update: any) => {
      if (update.docChanged && onChange) {
        const newValue = update.state.doc.toString()
        onChange(newValue)
      }
    })

    // Build extensions
    const extensions: Extension[] = [
      ...basicExtensions,
      keyBindings,
      updateListener,
      getLanguageExtension(language),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace' },
        '.cm-editor': { height: '100%' },
        '.cm-content': { padding: '12px' },
      }),
    ]

    // Add theme
    if (theme === 'dark') {
      extensions.push(oneDark)
    }

    // Set read-only if specified
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    // Create editor state
    const state = EditorState.create({
      doc: value,
      extensions,
    })

    // Create editor view
    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view
    setIsReady(true)

    // Cleanup
    return () => {
      view?.destroy()
      viewRef.current = null
      setIsReady(false)
    }
  }, [language, readOnly, theme, onSave, onChange])

  // Update editor content when value changes externally
  useEffect(() => {
    if (viewRef.current && value !== undefined) {
      const currentValue = viewRef.current.state.doc.toString()
      if (currentValue !== value) {
        const transaction = viewRef.current.state.update({
          changes: {
            from: 0,
            to: viewRef.current.state.doc.length,
            insert: value,
          },
        })
        viewRef.current.dispatch(transaction)
      }
    }
  }, [value])

  // Focus the editor
  const focus = () => {
    viewRef.current?.focus()
  }

  // Get current value
  const getValue = () => {
    return viewRef.current?.state.doc.toString() || ''
  }

  // Set value programmatically
  const setValue = (newValue: string) => {
    if (viewRef.current) {
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: newValue,
        },
      })
      viewRef.current.dispatch(transaction)
    }
  }

  return {
    ref: editorRef,
    view: viewRef.current,
    isReady,
    focus,
    getValue,
    setValue,
    getLanguageFromPath,
  }
}