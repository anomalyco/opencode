/**
 * Content script that runs on Claude.ai to fix iframe detection
 *
 * Claude.ai detects when it's running in an iframe and hides certain UI elements
 * like the sidebar toggle. This script overrides that detection and forces
 * the sidebar toggle to remain visible.
 */

export default defineContentScript({
  matches: ["https://claude.ai/*"],
  runAt: "document_start",
  world: "MAIN", // Run in page context to override window properties
  main() {
    // Override iframe detection by making window.self === window.top
    try {
      Object.defineProperty(window, "self", {
        get: () => window.top,
        configurable: true,
      })

      Object.defineProperty(window, "frameElement", {
        get: () => null,
        configurable: true,
      })

      // Also try to override parent
      Object.defineProperty(window, "parent", {
        get: () => window,
        configurable: true,
      })

      console.log("[Eidorail] Claude.ai iframe detection overridden")
    } catch (e) {
      console.warn("[Eidorail] Could not override iframe detection:", e)
    }

    // Inject CSS to force sidebar toggle visibility
    // This counteracts Claude.ai's opacity-0 class on the toggle button
    const style = document.createElement("style")
    style.textContent = `
      /* Force sidebar toggle button to be visible */
      button[data-testid="sidebar-toggle"] svg,
      button svg.opacity-0,
      [aria-label*="sidebar" i] svg.opacity-0,
      [aria-label*="menu" i] svg.opacity-0 {
        opacity: 1 !important;
        transform: scale(1) !important;
      }
      
      /* Ensure the button container is visible too */
      button:has(svg.opacity-0) {
        opacity: 1 !important;
        visibility: visible !important;
      }
    `

    // Insert style as early as possible
    if (document.head) {
      document.head.appendChild(style)
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        document.head.appendChild(style)
      })
    }
  },
})
