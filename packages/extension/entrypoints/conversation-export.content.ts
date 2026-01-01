/**
 * Multi-platform conversation export content script
 * Injects export UI into Claude, ChatGPT, and Gemini conversation pages
 */

import { extractByPlatform, waitForPlatformLoad } from "../utils/export/extractors"
import { exportAsMarkdown, exportAsJSON, downloadFile, copyToClipboard } from "../utils/export/formatters"
import { detectPlatform, getConversationId, isExportSupported, PLATFORMS } from "../utils/platforms"
import type { Conversation } from "../utils/export/types"
import type { Platform } from "../utils/platforms"

export default defineContentScript({
  matches: ["https://claude.ai/*", "https://chat.openai.com/*", "https://chatgpt.com/*", "https://gemini.google.com/*"],

  async main() {
    console.log("[Eidorail Export] Content script loaded")

    const platform = detectPlatform()
    if (!platform) {
      console.log("[Eidorail Export] Unknown platform, skipping")
      return
    }

    console.log("[Eidorail Export] Detected platform:", platform)

    if (!isExportSupported(platform)) {
      console.log("[Eidorail Export] Export not supported for platform:", platform)
      return
    }

    // Initial check and injection
    tryInjectUI(platform)

    // Handle SPA navigation - these sites use client-side routing
    let lastUrl = location.href
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        console.log("[Eidorail Export] URL changed:", lastUrl)
        // Remove old UI and re-inject for new conversation
        removeExportUI()
        tryInjectUI(platform)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Also listen to popstate for browser back/forward
    window.addEventListener("popstate", () => {
      console.log("[Eidorail Export] Popstate event")
      removeExportUI()
      tryInjectUI(platform)
    })
  },
})

function tryInjectUI(platform: Platform) {
  const conversationId = getConversationId(platform)
  if (!conversationId) {
    console.log("[Eidorail Export] Not a conversation page, skipping")
    return
  }

  console.log("[Eidorail Export] Conversation ID:", conversationId)

  waitForPlatformLoad(platform).then(() => {
    console.log("[Eidorail Export] Conversation loaded, injecting UI")
    injectExportUI(platform, conversationId)
  })
}

function removeExportUI() {
  const existing = document.getElementById("eidorail-export-root")
  if (existing) {
    existing.remove()
  }
}

function injectExportUI(platform: Platform, conversationId: string) {
  if (document.getElementById("eidorail-export-root")) {
    return
  }

  const container = document.createElement("div")
  container.id = "eidorail-export-root"
  document.body.appendChild(container)

  const shadow = container.attachShadow({ mode: "open" })
  const ui = new ExportUIManager(shadow, platform, conversationId)
  ui.render()
}

class ExportUIManager {
  private shadow: ShadowRoot
  private platform: Platform
  private conversationId: string
  private conversation: Conversation | null = null
  private selectedMessageIds: Set<string> = new Set()

  constructor(shadow: ShadowRoot, platform: Platform, conversationId: string) {
    this.shadow = shadow
    this.platform = platform
    this.conversationId = conversationId
  }

  render() {
    const styles = this.getStyles()
    const html = this.getHTML()

    this.shadow.innerHTML = `
      <style>${styles}</style>
      ${html}
    `

    this.attachEventListeners()
    this.loadConversation()
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
      }
      
      .export-container {
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9999;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 14px;
      }
      
      .export-icon-button {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        color: #374151;
      }
      
      .export-icon-button:hover {
        background: #f9fafb;
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
      
      .export-icon-button.menu-open {
        background: #f3f4f6;
      }
      
      .dropdown-menu {
        position: absolute;
        top: 52px;
        right: 0;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px) scale(0.95);
        transform-origin: top right;
        transition: all 0.15s ease;
        overflow: hidden;
      }
      
      .dropdown-menu.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }
      
      .menu-section {
        padding: 6px 0;
      }
      
      .menu-section:not(:last-child) {
        border-bottom: 1px solid #e5e7eb;
      }
      
      .menu-section-label {
        padding: 6px 14px;
        font-size: 11px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        transition: background 0.15s ease;
        color: #374151;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        font-size: 14px;
        font-family: inherit;
      }
      
      .menu-item:hover {
        background: #f3f4f6;
      }
      
      .menu-item:active {
        background: #e5e7eb;
      }
      
      .menu-item svg {
        flex-shrink: 0;
        color: #6b7280;
      }
      
      .menu-item span {
        flex: 1;
      }
      
      .menu-item.success {
        color: #059669;
      }
      
      .menu-item.success svg {
        color: #059669;
      }
      
      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1f2937;
        color: #ffffff;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(8px);
        transition: all 0.2s ease;
        z-index: 10000;
      }
      
      .toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      
      .toast.success {
        background: #059669;
      }
      
      .toast.error {
        background: #dc2626;
      }
      
      @media (prefers-color-scheme: dark) {
        .export-icon-button {
          background: #374151;
          border-color: #4b5563;
          color: #e5e7eb;
        }
        
        .export-icon-button:hover {
          background: #4b5563;
        }
        
        .export-icon-button.menu-open {
          background: #4b5563;
        }
        
        .dropdown-menu {
          background: #1f2937;
          border-color: #374151;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        
        .menu-section:not(:last-child) {
          border-color: #374151;
        }
        
        .menu-section-label {
          color: #6b7280;
        }
        
        .menu-item {
          color: #e5e7eb;
        }
        
        .menu-item:hover {
          background: #374151;
        }
        
        .menu-item:active {
          background: #4b5563;
        }
        
        .menu-item svg {
          color: #9ca3af;
        }
        
        .menu-item.success {
          color: #34d399;
        }
        
        .menu-item.success svg {
          color: #34d399;
        }
        
        .toast {
          background: #374151;
        }
      }
    `
  }

  private getHTML(): string {
    return `
      <div class="export-container">
        <button class="export-icon-button" id="icon-btn" title="Export Conversation">
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
        
        <div class="dropdown-menu" id="dropdown">
          <div class="menu-section">
            <div class="menu-section-label">Copy</div>
            <button class="menu-item" id="copy-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy as Markdown</span>
            </button>
            <button class="menu-item" id="copy-json">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy as JSON</span>
            </button>
          </div>
          <div class="menu-section">
            <div class="menu-section-label">Download</div>
            <button class="menu-item" id="download-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download Markdown</span>
            </button>
            <button class="menu-item" id="download-json">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download JSON</span>
            </button>
          </div>
        </div>
        
        <div class="toast" id="toast"></div>
      </div>
    `
  }

  private attachEventListeners() {
    const iconBtn = this.shadow.getElementById("icon-btn")
    const dropdown = this.shadow.getElementById("dropdown")

    iconBtn?.addEventListener("click", (e) => {
      e.stopPropagation()
      const isOpen = dropdown?.classList.contains("open")
      if (isOpen) {
        this.closeMenu()
      } else {
        this.openMenu()
      }
    })

    document.addEventListener("click", () => {
      this.closeMenu()
    })

    this.shadow.getElementById("copy-md")?.addEventListener("click", () => {
      this.handleAction("copy", "markdown")
    })

    this.shadow.getElementById("copy-json")?.addEventListener("click", () => {
      this.handleAction("copy", "json")
    })

    this.shadow.getElementById("download-md")?.addEventListener("click", () => {
      this.handleAction("download", "markdown")
    })

    this.shadow.getElementById("download-json")?.addEventListener("click", () => {
      this.handleAction("download", "json")
    })
  }

  private openMenu() {
    const iconBtn = this.shadow.getElementById("icon-btn")
    const dropdown = this.shadow.getElementById("dropdown")
    iconBtn?.classList.add("menu-open")
    dropdown?.classList.add("open")
  }

  private closeMenu() {
    const iconBtn = this.shadow.getElementById("icon-btn")
    const dropdown = this.shadow.getElementById("dropdown")
    iconBtn?.classList.remove("menu-open")
    dropdown?.classList.remove("open")
  }

  private showToast(message: string, type: "success" | "error" = "success") {
    const toast = this.shadow.getElementById("toast")
    if (!toast) return

    toast.textContent = message
    toast.className = `toast show ${type}`

    setTimeout(() => {
      toast.classList.remove("show")
    }, 2000)
  }

  private async handleAction(action: "copy" | "download", format: "markdown" | "json") {
    this.closeMenu()

    try {
      // Always re-extract fresh data to avoid stale conversation issues
      const conversation = await this.extractFreshConversation()

      if (!conversation || conversation.messages.length === 0) {
        this.showToast("No messages found", "error")
        return
      }

      // Select all messages for export
      const allMessageIds = new Set(conversation.messages.map((m) => m.id))

      const result =
        format === "markdown"
          ? exportAsMarkdown(conversation, allMessageIds)
          : exportAsJSON(conversation, allMessageIds)

      if (action === "copy") {
        const success = await copyToClipboard(result.content)
        if (success) {
          this.showToast(
            `Copied ${conversation.messages.length} messages as ${format === "markdown" ? "Markdown" : "JSON"}`,
          )
        } else {
          this.showToast("Failed to copy", "error")
        }
      } else {
        downloadFile(result.filename, result.content, result.mimeType)
        this.showToast(`Downloaded ${result.filename}`)
      }
    } catch (error) {
      console.error("[Eidorail Export] Action failed:", error)
      this.showToast(`Failed to ${action}`, "error")
    }
  }

  private async extractFreshConversation(): Promise<Conversation | null> {
    try {
      // Get fresh conversation ID from current URL
      const freshConversationId = getConversationId(this.platform) || this.conversationId
      const conversation = await extractByPlatform(this.platform, freshConversationId)
      console.log("[Eidorail Export] Fresh extraction:", conversation.messages.length, "messages")
      return conversation
    } catch (error) {
      console.error("[Eidorail Export] Extraction failed:", error)
      return null
    }
  }

  private async loadConversation() {
    try {
      this.conversation = await extractByPlatform(this.platform, this.conversationId)
      console.log("[Eidorail Export] Initial load:", this.conversation?.messages.length, "messages")

      if (this.conversation) {
        for (const msg of this.conversation.messages) {
          this.selectedMessageIds.add(msg.id)
        }
      }
    } catch (error) {
      console.error("[Eidorail Export] Failed to load conversation:", error)
    }
  }
}
