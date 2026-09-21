export function focusComposerEditor(fallback: () => void) {
  const dock = document.querySelector('[data-component="session-composer-dock"]')
  const editor = dock?.querySelector<HTMLElement>('[data-component="composer-editor"]')
  if (editor) {
    editor.focus()
    return
  }
  fallback()
}
