/** Swallow a trailing atomic mention pill on backspace.
 *
 * When a contenteditable="false" element (a mention pill) is the last node of
 * a contenteditable editor, there is no renderable collapsed caret position to
 * its right. Deleting the trailing whitespace that insertMention appends after
 * the pill therefore makes the caret disappear until the next keystroke. When
 * backspace lands in the pure-whitespace region after the last pill, this
 * helper deletes [pill start, caret) in one step, so a single backspace
 * removes the pill together with its trailing whitespace and the editor never
 * enters the no-caret state.
 *
 * Call from a beforeinput handler for deleteContentBackward. A true return
 * means the deletion was handled: the caller must preventDefault and dispatch
 * a synthetic input event so the regular parse-and-write-back path runs
 * (programmatic DOM mutations do not fire input events, same as onPaste).
 *
 * The pill selector is passed by the caller. */
export function swallowBackspacePill(editor: HTMLElement, selector: string): boolean {
  const selection = window.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return false
  const caret = selection.getRangeAt(0)
  if (!editor.contains(caret.startContainer)) return false
  const pills = editor.querySelectorAll<HTMLElement>(selector)
  const pill = pills[pills.length - 1]
  if (!pill || !editor.contains(pill)) return false
  // Everything between the pill and the end of the editor must be whitespace
  // (the trailing case); real content after the pill falls back to the default
  // backspace behavior. ZWSP must be stripped explicitly — trim does not treat
  // \u200B as whitespace, and a ZWSP-only tail is not content.
  const after = document.createRange()
  after.setStartAfter(pill)
  after.setEnd(editor, editor.childNodes.length)
  if (after.toString().replace(/\u200B/g, "").trim() !== "") return false
  // The caret must not sit before the end of the pill; this includes the
  // position right after the pill, where no caret can be rendered.
  if (after.compareBoundaryPoints(Range.START_TO_START, caret) > 0) return false
  const anchor = document.createRange()
  anchor.setStartBefore(pill)
  anchor.collapse(true)
  const deletion = document.createRange()
  deletion.setStartBefore(pill)
  deletion.setEnd(caret.startContainer, caret.startOffset)
  deletion.deleteContents()
  selection.removeAllRanges()
  selection.addRange(anchor)
  return true
}
