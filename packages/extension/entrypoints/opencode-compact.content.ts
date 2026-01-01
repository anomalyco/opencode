/**
 * Content script for OpenCode compact mode
 *
 * Injects CSS and behavior modifications when OpenCode is embedded
 * in the Eidorail extension sidebar (iframe context).
 *
 * This works with vanilla sst/opencode - no modifications needed to opencode itself.
 *
 * Addresses UI/UX feedback:
 * - Hides redundant left rail (icon soup) to maximize chat space
 * - De-emphasizes orange Home link, improves visual hierarchy
 * - Adds welcoming empty state overlay with guidance
 * - Improves spacing and alignment for narrow sidebar width
 * - Better hover states and accessibility
 */

export default defineContentScript({
  matches: ["http://localhost:4096/*", "http://127.0.0.1:4096/*"],
  runAt: "document_start",
  allFrames: true,

  main() {
    const params = new URLSearchParams(window.location.search)
    const compactMode = params.get("eidorail") === "compact"

    if (!compactMode) {
      return
    }

    console.log("[Eidorail] OpenCode compact mode activated")

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        injectCompactStyles()
        onDOMReady()
      })
    } else {
      injectCompactStyles()
      onDOMReady()
    }
  },
})

function injectCompactStyles() {
  const style = document.createElement("style")
  style.id = "eidorail-compact-styles"
  style.textContent = `
    /* ===========================================
       Eidorail Compact Mode for OpenCode Desktop
       Applied when embedded in browser extension
       =========================================== */

    /* ---- CORE: Left sidebar as toggleable overlay ---- */
    /* Sidebar hidden by default, shown as overlay when toggled */
    body.eidorail-compact > div > div > aside,
    body.eidorail-compact [data-sidebar],
    body.eidorail-compact .w-12.border-r,
    body.eidorail-compact > div > div > div:first-child[class*="border-r"] {
      display: none !important;
    }

    /* Mobile sidebar (w-72) - position as overlay when open */
    body.eidorail-compact .fixed.inset-y-0.left-0.z-50 {
      transform: translateX(-100%);
      transition: transform 0.2s ease;
    }

    body.eidorail-compact.sidebar-open .fixed.inset-y-0.left-0.z-50 {
      transform: translateX(0) !important;
      display: flex !important;
    }

    /* Backdrop when sidebar is open */
    body.eidorail-compact.sidebar-open::after {
      content: "";
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 49;
      pointer-events: auto;
    }

    /* ---- HEADER: Optimize for narrow width ---- */
    body.eidorail-compact header {
      padding-left: 12px !important;
      padding-right: 12px !important;
      gap: 8px !important;
    }

    /* De-emphasize the orange Home/Mark link - make it subtle */
    body.eidorail-compact header a[href="/"] svg,
    body.eidorail-compact header a:first-child svg {
      width: 20px !important;
      height: 20px !important;
      opacity: 0.7;
    }

    body.eidorail-compact header a[href="/"]:hover svg,
    body.eidorail-compact header a:first-child:hover svg {
      opacity: 1;
    }

    /* Project/session selectors - compact them */
    body.eidorail-compact header button[class*="text-14"] {
      padding: 4px 8px !important;
      font-size: 13px !important;
    }

    /* Hide unnecessary header elements on very narrow widths */
    @media (max-width: 350px) {
      body.eidorail-compact header > a:first-child {
        display: none !important;
      }
    }

    /* ---- MAIN CONTENT: Full width ---- */
    body.eidorail-compact main {
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
    }

    /* ---- HOME PAGE: Improve empty state ---- */
    /* Recent projects list - better hover states */
    body.eidorail-compact [class*="group/item"] {
      border-radius: 8px !important;
      transition: background-color 0.15s ease !important;
    }

    body.eidorail-compact [class*="group/item"]:hover {
      background-color: var(--color-background-surface, rgba(255,255,255,0.05)) !important;
    }

    /* Project items - add visual affordance */
    body.eidorail-compact [class*="group/item"]::before {
      content: "";
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 0;
      background: var(--color-text-brand, #f97316);
      border-radius: 0 2px 2px 0;
      transition: height 0.15s ease;
    }

    body.eidorail-compact [class*="group/item"]:hover::before {
      height: 60%;
    }

    /* ---- CHAT/SESSION: Optimize message display ---- */
    body.eidorail-compact [class*="message"],
    body.eidorail-compact [class*="Message"] {
      padding-left: 12px !important;
      padding-right: 12px !important;
    }

    /* Input area - ensure it's prominent */
    body.eidorail-compact textarea {
      font-size: 14px !important;
      min-height: 60px !important;
    }

    /* ---- ACCESSIBILITY: Larger touch targets ---- */
    body.eidorail-compact button {
      min-height: 36px !important;
      min-width: 36px !important;
    }

    body.eidorail-compact a[href] {
      min-height: 32px !important;
    }

    /* ---- EMPTY STATE OVERLAY ---- */
    /* Shows helpful guidance when no session is active */
    .eidorail-welcome-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      background: var(--color-background-base, #0a0a0a);
      z-index: 100;
      opacity: 1;
      transition: opacity 0.3s ease;
      pointer-events: auto;
    }

    .eidorail-welcome-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .eidorail-welcome-overlay h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-strong, #fff);
      margin: 0 0 8px 0;
    }

    .eidorail-welcome-overlay p {
      font-size: 14px;
      color: var(--color-text-dimmed, #888);
      margin: 0 0 20px 0;
      max-width: 280px;
      line-height: 1.5;
    }

    .eidorail-welcome-overlay .quick-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 240px;
    }

    .eidorail-welcome-overlay button {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid var(--color-border-base, #333);
      background: var(--color-background-surface, #1a1a1a);
      color: var(--color-text-base, #fff);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .eidorail-welcome-overlay button:hover {
      background: var(--color-background-hover, #252525);
      border-color: var(--color-border-strong, #444);
    }

    .eidorail-welcome-overlay button.primary {
      background: var(--color-text-brand, #f97316);
      border-color: transparent;
      color: #fff;
    }

    .eidorail-welcome-overlay button.primary:hover {
      background: #ea580c;
    }

    .eidorail-welcome-overlay .keyboard-hint {
      margin-top: 16px;
      font-size: 12px;
      color: var(--color-text-dimmed, #666);
    }

    .eidorail-welcome-overlay kbd {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--color-background-surface, #1a1a1a);
      border: 1px solid var(--color-border-base, #333);
      font-family: inherit;
      font-size: 11px;
    }

    /* ---- FLOATING MENU BUTTON ---- */
    /* Quick access to sidebar functions without the rail */
    .eidorail-menu-button {
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 1001;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--color-background-surface, #1a1a1a);
      border: 1px solid var(--color-border-base, #333);
      color: var(--color-text-base, #fff);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .eidorail-menu-button:hover {
      background: var(--color-background-hover, #252525);
      transform: scale(1.05);
    }

    .eidorail-menu-button svg {
      width: 18px;
      height: 18px;
    }



    /* ---- RESPONSIVE ADJUSTMENTS ---- */
    @media (max-width: 400px) {
      body.eidorail-compact header {
        padding-left: 8px !important;
        padding-right: 8px !important;
        height: 44px !important;
      }

      body.eidorail-compact header button span:not(:first-child) {
        display: none !important;
      }

      .eidorail-welcome-overlay {
        padding: 16px;
      }

      .eidorail-welcome-overlay h2 {
        font-size: 16px;
      }
    }

    /* ---- INPUT AREA: Dock to bottom ---- */
    body.eidorail-compact .absolute.inset-x-0.bottom-4 {
      bottom: 0 !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
      padding-bottom: 8px !important;
      background: var(--color-background-base, #0a0a0a) !important;
      border-top: 1px solid var(--color-border-weak-base, #333);
    }

    body.eidorail-compact [contenteditable="true"] {
      padding-left: 12px !important;
    }

    /* ---- HEADER: Compact padding ---- */
    body.eidorail-compact header > div {
      padding-left: 48px !important;
      padding-right: 12px !important;
    }

    /* ---- MENU BUTTON: Top-left position ---- */
    .eidorail-menu-button {
      bottom: auto !important;
      right: auto !important;
      top: 5px !important;
      left: 6px !important;
      width: 34px !important;
      height: 34px !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    .eidorail-menu-button:hover {
      background: var(--color-background-surface, #1a1a1a) !important;
      border: 1px solid var(--color-border-base, #333) !important;
    }



    /* ---- SIDEBAR: Overlay mode ---- */
    body.eidorail-compact .fixed.inset-y-0.left-0.w-72,
    body.eidorail-compact .xl\\:hidden > .fixed.inset-y-0.left-0,
    body.eidorail-compact [class*="fixed"][class*="inset-y-0"][class*="left-0"][class*="w-"] {
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      z-index: 50 !important;
    }

    body.eidorail-compact .eidorail-sidebar-visible,
    body.eidorail-compact.sidebar-open .fixed.inset-y-0.left-0.w-72,
    body.eidorail-compact.sidebar-open .xl\\:hidden > .fixed.inset-y-0.left-0 {
      transform: translateX(0) !important;
      display: flex !important;
    }

    /* ---- MOBILE LAYOUT: No bottom gap ---- */
    body.eidorail-compact .md\\:hidden.flex-1 {
      padding-bottom: 0 !important;
    }

    /* ---- SCROLLBAR: Subtle styling ---- */
    body.eidorail-compact ::-webkit-scrollbar {
      width: 6px;
    }

    body.eidorail-compact ::-webkit-scrollbar-track {
      background: transparent;
    }

    body.eidorail-compact ::-webkit-scrollbar-thumb {
      background: var(--color-border-base, #333);
      border-radius: 3px;
    }

    body.eidorail-compact ::-webkit-scrollbar-thumb:hover {
      background: var(--color-border-strong, #444);
    }

    /* ---- HOME PAGE: Reduce vertical spacing ---- */
    body.eidorail-compact main > div.mt-55,
    body.eidorail-compact main > div[class*="mt-55"] {
      margin-top: 24px !important;
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    body.eidorail-compact main > div.mt-55 > svg,
    body.eidorail-compact main > div[class*="mt-55"] > svg {
      max-width: 180px !important;
      height: auto !important;
    }

    body.eidorail-compact main div.mt-20 {
      margin-top: 16px !important;
    }

    body.eidorail-compact main div.mt-30 {
      margin-top: 24px !important;
    }

    body.eidorail-compact main [class~="mt-20"][class~="w-full"][class~="flex"][class~="flex-col"][class~="gap-4"]
      > [class~="flex"][class~="gap-2"][class~="items-center"][class~="justify-between"][class~="pl-3"] {
      flex-wrap: wrap !important;
      gap: 8px !important;
      align-items: flex-start;
    }

    body.eidorail-compact main [class~="mt-20"][class~="w-full"][class~="flex"][class~="flex-col"][class~="gap-4"]
      > [class~="flex"][class~="gap-2"][class~="items-center"][class~="justify-between"][class~="pl-3"]
      > button[class~="pl-2"][class~="pr-3"] {
      width: 100% !important;
    }

    /* Ensure home page content fits without scrolling at narrow widths */
    @media (max-height: 600px) {
      body.eidorail-compact main > div.mt-55,
      body.eidorail-compact main > div[class*="mt-55"] {
        margin-top: 12px !important;
      }
      
      body.eidorail-compact main > div.mt-55 > svg,
      body.eidorail-compact main > div[class*="mt-55"] > svg {
        max-width: 120px !important;
      }
      
      body.eidorail-compact main div.mt-20,
      body.eidorail-compact main div.mt-30 {
        margin-top: 12px !important;
      }
    }
    
    /* Extra compact for very narrow viewports */
    @media (max-width: 350px) {
      body.eidorail-compact main > div.mt-55,
      body.eidorail-compact main > div[class*="mt-55"] {
        margin-top: 16px !important;
      }
      
      body.eidorail-compact main > div.mt-55 > svg,
      body.eidorail-compact main > div[class*="mt-55"] > svg {
        max-width: 140px !important;
      }
    }
  `

  // Insert as early as possible
  if (document.head) {
    document.head.appendChild(style)
  } else {
    document.documentElement.appendChild(style)
  }
}

function onDOMReady() {
  document.body.classList.add("eidorail-compact")
  ensureSidebarClosed()
  addMenuButton()
  closeSidebarOnBackdropClick()
  checkAndShowWelcome()
  observeStateChanges()
}

function ensureSidebarClosed() {
  try {
    const layoutKey = "default-layout.v7"
    const stored = localStorage.getItem(layoutKey)
    if (stored) {
      const layout = JSON.parse(stored)
      if (layout.sidebar && layout.sidebar.opened) {
        layout.sidebar.opened = false
        localStorage.setItem(layoutKey, JSON.stringify(layout))
        console.log("[Eidorail] Ensured sidebar is closed")
      }
    }
  } catch (e) {
    console.warn("[Eidorail] Could not modify sidebar state:", e)
  }
}

function addMenuButton() {
  if (document.querySelector(".eidorail-menu-button")) return

  const button = document.createElement("button")
  button.className = "eidorail-menu-button"
  button.title = "Toggle sidebar"
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 12h18M3 6h18M3 18h18"/>
    </svg>
  `

  button.addEventListener("click", (e) => {
    e.stopPropagation()
    toggleSidebar()
  })

  document.body.appendChild(button)
}

function findSidebar(): HTMLElement | null {
  const selectors = [
    ".fixed.inset-y-0.left-0.w-72",
    ".fixed.inset-y-0.left-0.z-50",
    '[class*="fixed"][class*="inset-y-0"][class*="left-0"][class*="w-"]',
    "aside.fixed",
    '[data-sidebar="true"]',
  ]
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement
    if (el && el.offsetWidth > 50) return el
  }
  return null
}

function toggleSidebar() {
  const sidebar = findSidebar()
  if (!sidebar) {
    console.warn("[Eidorail] Sidebar element not found")
    return
  }

  const isOpen = document.body.classList.toggle("sidebar-open")
  sidebar.classList.toggle("eidorail-sidebar-visible", isOpen)
  updateSidebarState(isOpen)
}

function updateSidebarState(opened: boolean) {
  try {
    const layoutKey = "default-layout.v7"
    const stored = localStorage.getItem(layoutKey)
    const layout = stored ? JSON.parse(stored) : {}
    layout.sidebar = layout.sidebar || {}
    layout.sidebar.opened = opened
    localStorage.setItem(layoutKey, JSON.stringify(layout))
    window.dispatchEvent(new StorageEvent("storage", { key: layoutKey }))
  } catch (e) {
    console.warn("[Eidorail] Could not update sidebar state:", e)
  }
}

function closeSidebarOnBackdropClick() {
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return
    const target = e.target as HTMLElement
    const sidebar = findSidebar()
    const menuButton = document.querySelector(".eidorail-menu-button")
    if (sidebar?.contains(target) || menuButton?.contains(target)) return
    sidebar?.classList.remove("eidorail-sidebar-visible")
    document.body.classList.remove("sidebar-open")
    updateSidebarState(false)
  })
}

function checkAndShowWelcome() {
  // Show welcome overlay when on home page with no active session
  const isHomePage = window.location.pathname === "/" || window.location.pathname === ""
  const hasSession = window.location.pathname.includes("/session/")

  if (isHomePage && !hasSession) {
    // Check if there are recent projects - if so, don't show welcome
    const hasProjects = document.querySelector('[class*="group/item"]')
    if (!hasProjects) {
      showWelcomeOverlay()
    }
  }
}

function showWelcomeOverlay() {
  if (document.querySelector(".eidorail-welcome-overlay")) return

  const overlay = document.createElement("div")
  overlay.className = "eidorail-welcome-overlay"
  overlay.innerHTML = `
    <h2>Welcome to OpenCode</h2>
    <p>Your AI coding assistant, right in your browser sidebar.</p>
    <div class="quick-actions">
      <button class="primary" data-action="start-chat">
        Start a new chat
      </button>
      <button data-action="open-project">
        Open a project folder
      </button>
    </div>
    <div class="keyboard-hint">
      Press <kbd>⌘</kbd> + <kbd>K</kbd> to open command palette
    </div>
  `

  overlay.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const actionButton = target.closest("button[data-action]") as HTMLElement
    if (!actionButton) return

    const action = actionButton.dataset.action
    overlay.classList.add("hidden")

    setTimeout(() => overlay.remove(), 300)

    if (action === "start-chat") {
      // Focus the input or trigger new session
      const input = document.querySelector("textarea") as HTMLTextAreaElement
      if (input) input.focus()
    } else if (action === "open-project") {
      // Trigger open project dialog
      const openBtn = document.querySelector('button:has(svg[class*="folder"])') as HTMLButtonElement
      if (openBtn) openBtn.click()
    }
  })

  document.body.appendChild(overlay)

  // Hide overlay when user starts interacting
  const hideOnInteraction = () => {
    overlay.classList.add("hidden")
    setTimeout(() => overlay.remove(), 300)
    document.removeEventListener("keydown", hideOnInteraction)
  }

  document.addEventListener("keydown", hideOnInteraction)
}

function observeStateChanges() {
  // Watch for URL changes to hide/show welcome
  let lastPath = window.location.pathname
  const checkPath = () => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname
      const overlay = document.querySelector(".eidorail-welcome-overlay")
      if (overlay && window.location.pathname.includes("/session/")) {
        overlay.classList.add("hidden")
      }
    }
  }

  // Use MutationObserver to detect navigation
  const observer = new MutationObserver(checkPath)
  observer.observe(document.body, { childList: true, subtree: true })

  // Also check periodically (for SPA navigation)
  setInterval(checkPath, 500)

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("sidebar-open")) {
      const sidebar = findSidebar()
      sidebar?.classList.remove("eidorail-sidebar-visible")
      document.body.classList.remove("sidebar-open")
      updateSidebarState(false)
    }
  })
}
