/**
 * Initialize default server URL in localStorage and hide share button
 */

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"
const DEFAULT_SERVER_URL = "https://vibe.laterdev.com/opencode-api"

function hideShareButton() {
  // Use MutationObserver to hide share button when it appears
  const hideElements = () => {
    // Find and hide all buttons containing share-related text
    const buttons = Array.from(document.querySelectorAll("button"))
    buttons.forEach((button) => {
      const text = button.textContent?.toLowerCase() || ""
      if (text.includes("share") || text.includes("分享") || text.includes("共有")) {
        const parent = button.closest("div.flex.items-center") as HTMLElement
        if (parent) {
          parent.style.display = "none"
          console.log("[init-server] Share button section hidden")
        }
      }
    })
  }

  // Run immediately
  hideElements()

  // Watch for DOM changes to catch dynamically loaded share buttons
  const observer = new MutationObserver(hideElements)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

export function initDefaultServer() {
  if (typeof localStorage === "undefined") return

  try {
    // Only set if not already configured
    const existing = localStorage.getItem(DEFAULT_SERVER_URL_KEY)
    if (!existing) {
      localStorage.setItem(DEFAULT_SERVER_URL_KEY, DEFAULT_SERVER_URL)
      console.log(`[init-server] Set default server to: ${DEFAULT_SERVER_URL}`)
    } else {
      console.log(`[init-server] Default server already set to: ${existing}`)
    }
  } catch (error) {
    console.error("[init-server] Failed to set default server:", error)
  }

  // Hide share button
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hideShareButton)
  } else {
    hideShareButton()
  }
}
