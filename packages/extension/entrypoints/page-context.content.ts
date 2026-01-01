import { Readability } from "@mozilla/readability"
import { htmlToMarkdown, formatCapturedContent } from "../utils/markdown-converter"

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "EXTRACT_PAGE_CONTENT") {
        const result = extractPageContent()
        sendResponse(result)
        return true
      }

      if (message.type === "EXTRACT_SELECTION") {
        const result = extractSelection()
        sendResponse(result)
        return true
      }
    })
  },
})

function extractPageContent(): { success: boolean; markdown?: string; error?: string } {
  const clone = document.cloneNode(true) as Document
  const reader = new Readability(clone)
  const article = reader.parse()

  if (!article || !article.content) {
    return { success: false, error: "Could not parse page content" }
  }

  const markdown = htmlToMarkdown(article.content)
  const title = article.title || document.title || "Untitled"
  const formatted = formatCapturedContent({
    title,
    url: window.location.href,
    content: markdown,
    type: "page",
  })

  return { success: true, markdown: formatted }
}

function extractSelection(): { success: boolean; markdown?: string; error?: string } {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    return { success: false, error: "No text selected" }
  }

  const range = selection.getRangeAt(0)
  const container = document.createElement("div")
  container.appendChild(range.cloneContents())

  const html = container.innerHTML
  if (!html.trim()) {
    return { success: false, error: "Selection is empty" }
  }

  const markdown = htmlToMarkdown(html)
  const formatted = formatCapturedContent({
    title: document.title,
    url: window.location.href,
    content: markdown,
    type: "selection",
  })

  return { success: true, markdown: formatted }
}
