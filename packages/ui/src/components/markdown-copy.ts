export const markdownClipboardFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const markdownClipboardMonoFont =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

export type MarkdownCopyMode = "plain" | "rich" | "ask"

function addStyle(el: Element, value: string) {
  const style = el.getAttribute("style")
  if (!style) {
    el.setAttribute("style", value)
    return
  }
  el.setAttribute("style", `${style} ${value}`)
}

function inlineClipboardStyles(value: string) {
  if (typeof DOMParser === "undefined") return value
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html")
  const root = doc.body.firstElementChild
  if (!root) return value
  for (const link of root.querySelectorAll("a")) {
    addStyle(link, "color: #0b66d2; text-decoration: underline; text-underline-offset: 2px;")
  }
  for (const block of root.querySelectorAll("pre")) {
    addStyle(
      block,
      `font-family: ${markdownClipboardMonoFont}; font-size: 13px; line-height: 1.45; background: #f6f8fa; border-radius: 6px; padding: 8px 12px;`,
    )
  }
  for (const code of root.querySelectorAll("code")) {
    addStyle(code, `font-family: ${markdownClipboardMonoFont}; font-size: 13px;`)
  }
  return root.innerHTML
}

export function serializeMarkdownClipboardHTML(value: string) {
  const html = inlineClipboardStyles(value.trim())
  if (!html) return ""
  return `<div style="font-family: ${markdownClipboardFont};">${html}</div>`
}

export async function writeClipboardPayload(input: { text: string; html?: string }) {
  const clipboard = navigator.clipboard
  if (!clipboard) return
  if (!input.html || typeof ClipboardItem === "undefined" || typeof clipboard.write !== "function") {
    await clipboard.writeText(input.text)
    return
  }
  await clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([input.text], { type: "text/plain" }),
      "text/html": new Blob([input.html], { type: "text/html" }),
    }),
  ])
}

export async function writeMarkdownClipboard(input: { text: string; html?: string }) {
  if (!input.text) return
  const html = serializeMarkdownClipboardHTML(input.html ?? "")
  await writeClipboardPayload({ text: input.text, html: html || undefined })
}
