import { writeMarkdownClipboard } from "../../components/markdown-copy"

type Root = {
  querySelector(selector: string): Element | null
}

export function cleanMarkdownHTML(value: string) {
  if (!value) return value
  if (typeof DOMParser === "undefined") {
    return value.replace(/<button[^>]*data-slot=["']markdown-copy-button["'][^>]*>[\s\S]*?<\/button>/g, "")
  }

  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html")
  const root = doc.body.firstElementChild
  if (!root) return value
  for (const item of root.querySelectorAll('[data-slot="markdown-copy-button"]')) {
    item.remove()
  }
  return root.innerHTML
}

export async function copyMarkdownElement(root: Root | undefined, text: string) {
  if (!text) return
  const markdown = root?.querySelector('[data-component="markdown"]')
  if (!(markdown instanceof HTMLDivElement)) {
    await navigator.clipboard.writeText(text)
    return
  }

  const wrap = document.createElement("div")
  wrap.innerHTML = markdown.innerHTML
  await writeMarkdownClipboard({ text, html: cleanMarkdownHTML(wrap.innerHTML) })
}
