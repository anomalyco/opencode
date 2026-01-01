/**
 * Platform-specific conversation extraction utilities
 */

import type { Conversation, Message } from "./types"
import type { Platform } from "../platforms"

/**
 * Extract Claude conversation from DOM
 * Claude uses a turn-based structure with user and assistant messages
 */
export function extractClaude(conversationId: string): Conversation {
  console.log("[Eidorail Export] Extracting Claude conversation...")

  let title = "Untitled Conversation"

  // Try to get title from the sidebar or header
  const titleSelectors = [
    '[data-testid="conversation-title"]',
    'button[data-testid="chat-menu-trigger"]',
    "h1",
    '[class*="ConversationTitle"]',
    "header h1",
  ]

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector)
    const text = element?.textContent?.trim()
    if (text && text.length > 0 && text.length < 200) {
      title = text
      break
    }
  }

  const messages: Message[] = []
  let msgIndex = 0

  // Claude structures conversations as turns - each turn contains either human or assistant content
  // Look for the main conversation container and extract turns in order
  const turnContainers = document.querySelectorAll('[data-testid^="chat-message"]')

  if (turnContainers.length > 0) {
    for (const turn of turnContainers) {
      const testId = turn.getAttribute("data-testid") || ""
      const isUser = testId.includes("human") || testId.includes("user")

      const cloned = turn.cloneNode(true) as Element
      // Remove thinking blocks and other non-content elements
      cloned.querySelectorAll('[class*="thinking"], [class*="Thinking"], button, svg').forEach((el) => el.remove())

      const content = cloned.textContent?.trim() || ""
      if (content) {
        messages.push({
          id: `msg-claude-${msgIndex++}`,
          role: isUser ? "user" : "assistant",
          content,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  // Fallback: look for message containers by class patterns
  if (messages.length === 0) {
    const messageBlocks = document.querySelectorAll(
      ".font-user-message, .font-claude-message, [class*='human-turn'], [class*='assistant-turn']",
    )

    const seen = new Set<Element>()
    for (const elem of messageBlocks) {
      // Avoid duplicates from nested elements
      if (seen.has(elem) || Array.from(seen).some((s) => s.contains(elem) || elem.contains(s))) continue
      seen.add(elem)

      const classes = elem.className || ""
      const isUser =
        classes.includes("font-user") || classes.includes("human") || elem.closest('[class*="human"]') !== null

      const cloned = elem.cloneNode(true) as Element
      cloned.querySelectorAll('[class*="thinking"], button, svg').forEach((el) => el.remove())

      const content = cloned.textContent?.trim() || ""
      if (content) {
        messages.push({
          id: `msg-claude-${msgIndex++}`,
          role: isUser ? "user" : "assistant",
          content,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  console.log("[Eidorail Export] Extracted", messages.length, "Claude messages")

  return {
    id: conversationId,
    title,
    messages,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: "claude.ai",
  }
}

/**
 * Try to fetch ChatGPT conversation from the backend API
 * This is more reliable than DOM scraping
 */
async function fetchChatGPTFromAPI(conversationId: string): Promise<Conversation | null> {
  try {
    const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
      credentials: "include",
    })

    if (!response.ok) return null

    const data = await response.json()

    const messages: Message[] = []
    const mapping = data.mapping || {}

    // Build the message tree - find root and traverse
    const nodeIds = Object.keys(mapping)
    const childToParent = new Map<string, string>()

    for (const nodeId of nodeIds) {
      const node = mapping[nodeId]
      if (node.parent) {
        childToParent.set(nodeId, node.parent)
      }
    }

    // Find leaf nodes and traverse back to build order
    const orderedNodes: string[] = []
    const visited = new Set<string>()

    // Find the current node (usually the last message)
    let currentNode = data.current_node

    // Traverse from current back to root to get the path
    const pathToRoot: string[] = []
    while (currentNode && !visited.has(currentNode)) {
      visited.add(currentNode)
      pathToRoot.unshift(currentNode)
      currentNode = childToParent.get(currentNode)
    }

    // Extract messages from the path
    let idx = 0
    for (const nodeId of pathToRoot) {
      const node = mapping[nodeId]
      if (!node?.message) continue

      const msg = node.message
      const role = msg.author?.role

      if (role !== "user" && role !== "assistant") continue

      const parts = msg.content?.parts || []
      const content = parts
        .filter((p: unknown) => typeof p === "string")
        .join("\n")
        .trim()

      if (content) {
        messages.push({
          id: `msg-chatgpt-${idx++}`,
          role: role as "user" | "assistant",
          content,
          timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : new Date().toISOString(),
        })
      }
    }

    return {
      id: conversationId,
      title: data.title || "Untitled Conversation",
      messages,
      created_at: data.create_time ? new Date(data.create_time * 1000).toISOString() : new Date().toISOString(),
      updated_at: data.update_time ? new Date(data.update_time * 1000).toISOString() : new Date().toISOString(),
      source: "chatgpt.com",
    }
  } catch (error) {
    console.error("[Eidorail Export] API fetch failed:", error)
    return null
  }
}

/**
 * Extract ChatGPT conversation from DOM (fallback)
 */
function extractChatGPTFromDOM(conversationId: string): Conversation {
  console.log("[Eidorail Export] Extracting ChatGPT from DOM...")

  let title = document.title.replace(" - ChatGPT", "").replace("ChatGPT", "").trim() || "Untitled Conversation"

  // Try to get title from the page
  const titleEl = document.querySelector('h1, [data-testid*="title"]')
  if (titleEl?.textContent?.trim()) {
    title = titleEl.textContent.trim()
  }

  const messages: Message[] = []

  // ChatGPT uses article elements for each message turn
  const articles = document.querySelectorAll("article[data-testid]")

  let idx = 0
  for (const article of articles) {
    // Determine role from data-testid or header
    const testId = article.getAttribute("data-testid") || ""
    const header = article.querySelector("h5, h6")?.textContent?.toLowerCase() || ""

    const isUser = testId.includes("user") || header.includes("you said") || header.includes("you")

    // Get the message content - look for the prose/markdown container
    const contentContainer = article.querySelector(
      '[data-message-content="true"], .markdown, .prose, [class*="markdown"], [class*="prose"]',
    )

    let content = ""
    if (contentContainer) {
      const cloned = contentContainer.cloneNode(true) as Element
      // Remove buttons and interactive elements
      cloned.querySelectorAll("button, svg, [role='button']").forEach((el) => el.remove())
      content = cloned.textContent?.trim() || ""
    } else {
      // Fallback: get all text from the article excluding the header
      const cloned = article.cloneNode(true) as Element
      cloned.querySelectorAll("h5, h6, button, svg").forEach((el) => el.remove())
      content = cloned.textContent?.trim() || ""
    }

    if (content) {
      messages.push({
        id: `msg-chatgpt-${idx++}`,
        role: isUser ? "user" : "assistant",
        content,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Fallback: if no articles with data-testid, try plain articles
  if (messages.length === 0) {
    const plainArticles = document.querySelectorAll("article")
    for (const article of plainArticles) {
      const header = article.querySelector("h5, h6")?.textContent?.toLowerCase() || ""
      const isUser = header.includes("you")

      const cloned = article.cloneNode(true) as Element
      cloned.querySelectorAll("h5, h6, button, svg").forEach((el) => el.remove())
      const content = cloned.textContent?.trim() || ""

      if (content) {
        messages.push({
          id: `msg-chatgpt-${idx++}`,
          role: isUser ? "user" : "assistant",
          content,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  console.log("[Eidorail Export] Extracted", messages.length, "ChatGPT messages from DOM")

  return {
    id: conversationId,
    title,
    messages,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: "chatgpt.com",
  }
}

/**
 * Extract ChatGPT conversation - tries API first, falls back to DOM
 */
export async function extractChatGPT(conversationId: string): Promise<Conversation> {
  console.log("[Eidorail Export] Extracting ChatGPT conversation...")

  // Try API first - much more reliable
  const apiResult = await fetchChatGPTFromAPI(conversationId)
  if (apiResult && apiResult.messages.length > 0) {
    console.log("[Eidorail Export] Got", apiResult.messages.length, "messages from API")
    return apiResult
  }

  // Fallback to DOM scraping
  return extractChatGPTFromDOM(conversationId)
}

/**
 * Extract Gemini conversation from DOM
 */
export function extractGemini(conversationId: string): Conversation {
  console.log("[Eidorail Export] Extracting Gemini conversation...")

  let title = "Untitled Conversation"

  const titleSelectors = [
    'div[data-test-id="conversation"].selected .conversation-title',
    "h1",
    '[class*="conversation-title"]',
  ]

  for (const selector of titleSelectors) {
    const elem = document.querySelector(selector)
    if (elem?.textContent?.trim()) {
      title = elem.textContent.trim()
      break
    }
  }

  title = title.replace(/^Gemini\s*-\s*/i, "").trim() || "Untitled Conversation"

  const messages: Message[] = []
  const messageElements = document.querySelectorAll("user-query, model-response")

  let idx = 0
  for (const elem of messageElements) {
    const tagName = elem.tagName.toLowerCase()
    const isUser = tagName === "user-query"

    const contentSelector = isUser ? "div.query-content" : "message-content"
    const contentElem = elem.querySelector(contentSelector)
    const content = contentElem?.textContent?.trim() || ""

    if (content) {
      messages.push({
        id: `msg-gemini-${idx++}`,
        role: isUser ? "user" : "assistant",
        content,
        timestamp: new Date().toISOString(),
      })
    }
  }

  console.log("[Eidorail Export] Extracted", messages.length, "Gemini messages")

  return {
    id: conversationId,
    title,
    messages,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: "gemini.google.com",
  }
}

/**
 * Extract conversation using platform-specific extractor
 */
export async function extractByPlatform(platform: Platform, conversationId: string): Promise<Conversation> {
  switch (platform) {
    case "claude":
      return extractClaude(conversationId)
    case "chatgpt":
      return await extractChatGPT(conversationId)
    case "gemini":
      return extractGemini(conversationId)
    default:
      throw new Error(`Unsupported platform for export: ${platform}`)
  }
}

/**
 * Wait for conversation to load based on platform
 * Uses multiple selectors and waits for content to stabilize
 */
export function waitForPlatformLoad(platform: Platform): Promise<void> {
  return new Promise((resolve) => {
    const selectors: string[] = []

    switch (platform) {
      case "claude":
        selectors.push(
          '[data-testid^="chat-message"]',
          ".font-user-message",
          ".font-claude-message",
          '[class*="human-turn"]',
          '[class*="assistant-turn"]',
        )
        break
      case "chatgpt":
        selectors.push("article[data-testid]", "article", "[data-message-author-role]", '[class*="markdown"]')
        break
      case "gemini":
        selectors.push("user-query", "model-response", "message-content")
        break
      default:
        resolve()
        return
    }

    const checkLoaded = () => {
      for (const selector of selectors) {
        if (document.querySelector(selector)) {
          return true
        }
      }
      return false
    }

    if (checkLoaded()) {
      // Wait a bit more for content to stabilize
      setTimeout(resolve, 500)
      return
    }

    const observer = new MutationObserver(() => {
      if (checkLoaded()) {
        observer.disconnect()
        // Wait for content to stabilize
        setTimeout(resolve, 500)
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Longer timeout for slow connections
    setTimeout(() => {
      observer.disconnect()
      resolve()
    }, 15000)
  })
}
