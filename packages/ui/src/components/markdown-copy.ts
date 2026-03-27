import DOMPurify from "dompurify"

export const markdownClipboardFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const markdownClipboardMonoFont =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

export type MarkdownCopyMode = "plain" | "rich" | "ask"

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style", "img", "video", "audio", "iframe", "script"],
  FORBID_CONTENTS: ["style", "script"],
}

const banned = config.FORBID_TAGS.join(",")

function strip(value: string) {
  const html = value.trim()
  if (!html) return html
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<(?:img|video|audio|iframe)\b[^>]*>/gi, "")
      .replace(/<\/(?:video|audio|iframe)>/gi, "")
      .trim()
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = doc.body.firstElementChild
  if (!root) return html
  for (const el of root.querySelectorAll(banned)) {
    el.remove()
  }
  return root.innerHTML.trim()
}

function sanitize(value: string) {
  if (!DOMPurify.isSupported) return strip(value)
  return DOMPurify.sanitize(value, config).trim()
}

function addStyle(el: Element, value: string) {
  const style = el.getAttribute("style")
  if (!style) {
    el.setAttribute("style", value)
    return
  }
  el.setAttribute("style", `${style} ${value}`)
}

function secureLink(el: Element) {
  if (!(el instanceof HTMLAnchorElement)) return
  if (el.target !== "_blank") return
  const rel = el.getAttribute("rel") ?? ""
  const set = new Set(rel.split(/\s+/).filter(Boolean))
  set.add("noopener")
  set.add("noreferrer")
  el.setAttribute("rel", Array.from(set).join(" "))
}

function inlineClipboardStyles(value: string) {
  const html = strip(sanitize(value))
  if (!html || typeof DOMParser === "undefined") return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = doc.body.firstElementChild
  if (!root) return html
  for (const link of root.querySelectorAll("a")) {
    secureLink(link)
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
  const html = inlineClipboardStyles(value)
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
