import type { Page } from "@playwright/test"

export type ComposerPasteFixture = {
  label: string
  chars: number
  lines: number
  crlf?: boolean
}

export type ComposerPasteSample = {
  chars: number
  dispatchMs: number
  settleMs: number
  longTasks: number
  longestTaskMs: number
  blockedMs: number
  editorElements: number
  editorTextLength: number
  lossless: boolean
}

export function buildFixtureText(fixture: ComposerPasteFixture) {
  const newline = fixture.crlf ? "\r\n" : "\n"
  if (fixture.lines <= 1)
    return "abcdefghij klmnopqrst uvwxyz0123 ".repeat(Math.ceil(fixture.chars / 33)).slice(0, fixture.chars)
  const per = Math.max(1, Math.floor(fixture.chars / fixture.lines) - newline.length)
  const body = "abcdefghij klmnopqrst uvwxyz0123 ".repeat(Math.ceil(per / 33))
  return Array.from({ length: fixture.lines }, (_, index) => `${index} ${body}`.slice(0, per)).join(newline)
}

// Measured entirely inside the page: the CDP transfer of the payload happens before
// the observation window opens, so it never contributes to the reported latency.
export async function measureComposerPaste(page: Page, selector: string, text: string): Promise<ComposerPasteSample> {
  return page.evaluate(
    async ([target, payload]) => {
      const editor = document.querySelector(target)
      if (!(editor instanceof HTMLElement)) throw new Error(`No composer editor for ${target}`)

      const longTasks: number[] = []
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push(entry.duration))
      })
      observer.observe({ entryTypes: ["longtask"] })

      editor.focus()
      const selection = window.getSelection()
      const caret = document.createRange()
      caret.selectNodeContents(editor)
      caret.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(caret)

      const transfer = new DataTransfer()
      transfer.setData("text/plain", payload)

      const start = performance.now()
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }))
      const dispatched = performance.now()

      // Two consecutive frames means reactive effects, editor reconciliation, layout
      // and paint have all drained, so the editor is interactive again.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const settled = performance.now()
      observer.disconnect()

      // textContent drops line breaks, which both composers model as <br> (and which
      // Chromium additionally wraps in block containers), so read the editor the same
      // way the composers parse it back into prompt parts.
      const blocks = new Set(["DIV", "P", "LI", "PRE"])
      const read = (root: Node) => {
        let out = ""
        const walk = (node: Node) => {
          node.childNodes.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
              out += child.nodeValue ?? ""
              return
            }
            if (!(child instanceof HTMLElement)) return
            if (child.tagName === "BR") {
              out += "\n"
              return
            }
            if (out.length > 0 && blocks.has(child.tagName)) out += "\n"
            walk(child)
          })
        }
        walk(root)
        return out
      }

      const expected = payload.replace(/\r\n?/g, "\n")
      const actual = read(editor)
        .replace(/\u200B/g, "")
        .replace(/\r\n?/g, "\n")
      return {
        chars: payload.length,
        dispatchMs: dispatched - start,
        settleMs: settled - start,
        longTasks: longTasks.length,
        longestTaskMs: longTasks.reduce((max, value) => Math.max(max, value), 0),
        blockedMs: longTasks.reduce((total, value) => total + value, 0),
        editorElements: editor.querySelectorAll("*").length,
        editorTextLength: actual.length,
        lossless: actual.endsWith(expected),
      }
    },
    [selector, text] as const,
  )
}

export type ComposerTypingSample = { syncMs: number; settleMs: number }

// A paste is a single event, but the draft it leaves behind is what every following keystroke
// has to walk. Typing is measured separately so a fast paste cannot hide a composer that has
// become unusable afterwards.
export async function measureComposerTyping(page: Page, selector: string, keystrokes: number) {
  return page.evaluate(
    async ([target, count]) => {
      const editor = document.querySelector(target)
      if (!(editor instanceof HTMLElement)) throw new Error(`No composer editor for ${target}`)
      editor.focus()
      const caret = document.createRange()
      caret.selectNodeContents(editor)
      caret.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(caret)

      const samples: { syncMs: number; settleMs: number }[] = []
      for (let index = 0; index < count; index += 1) {
        const start = performance.now()
        document.execCommand("insertText", false, "x")
        // The input handler runs synchronously inside execCommand, so this is the part of a
        // keystroke that the draft size can make unbounded.
        const sync = performance.now()
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        samples.push({ syncMs: sync - start, settleMs: performance.now() - start })
      }
      return samples
    },
    [selector, keystrokes] as const,
  )
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]!
}
