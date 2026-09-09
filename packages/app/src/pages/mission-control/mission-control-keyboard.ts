const editorSelector = "input, textarea, select, [role='textbox'], [contenteditable]:not([contenteditable='false'])"

export function missionControlEditor(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined
  return target.closest<HTMLElement>(editorSelector) ?? undefined
}
