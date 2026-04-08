// ============================================================
// Lazy loading & initialization
// ============================================================

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null
let idCounter = 0

function detectTheme(): "dark" | "default" {
  const root = document.documentElement
  // Detect common dark theme indicators
  if (
    root.classList.contains("dark") ||
    root.getAttribute("data-theme") === "dark" ||
    root.getAttribute("data-color-mode") === "dark"
  ) {
    return "dark"
  }
  // Detect background luminance via CSS variable
  const bg = getComputedStyle(root).getPropertyValue("--color-background")
  if (bg) {
    const temp = document.createElement("div")
    temp.style.color = bg
    document.body.appendChild(temp)
    const computed = getComputedStyle(temp).color
    document.body.removeChild(temp)
    const match = computed.match(/\d+/g)
    if (match) {
      const [r, g, b] = match.map(Number)
      // Use luminance formula to determine theme
      if ((r * 299 + g * 587 + b * 114) / 1000 < 128) return "dark"
    }
  }
  return "default"
}

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        fontFamily: "var(--font-family-mono, monospace)",
        suppressErrorRendering: true,
        theme: detectTheme(),
      })
      return m.default
    })
  }
  return mermaidPromise
}

function generateId(): string {
  return `mermaid-${Date.now()}-${++idCounter}`
}

// ============================================================
// SVG icon paths (consistent with markdown.tsx icon approach)
// ============================================================

const icons = {
  zoomIn:
    '<path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  zoomOut:
    '<path d="M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  reset:
    '<path d="M4.5 10.5C4.5 6.36 7.86 3 12 3C16.14 3 19.5 6.36 19.5 10.5C19.5 14.64 16.14 18 12 18C10.05 18 8.28 17.25 6.96 16.02" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 14L7 16L5 13L4 14Z" fill="currentColor"/>',
  fullscreen:
    '<path d="M4 4H9M4 4V9M4 4L9 9M16 4H11M16 4V9M16 4L11 9M4 16H9M4 16V11M4 16L9 11M16 16H11M16 16V11M16 16L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  download:
    '<path d="M10 3V13M10 13L6 9M10 13L14 9M3 17H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check:
    '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
  close:
    '<path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
}

function createSvgIcon(path: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`)
  svg.setAttribute("width", String(size))
  svg.setAttribute("height", String(size))
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  return svg
}

// ============================================================
// Zoom & pan state management
// ============================================================

interface PanZoomState {
  zoom: number
  panX: number
  panY: number
  isPanning: boolean
  startX: number
  startY: number
  startPanX: number
  startPanY: number
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.1

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100))
}

function applyTransform(transformEl: HTMLElement, state: PanZoomState) {
  transformEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`
}

// ============================================================
// Interactive control buttons
// ============================================================

function createControlButton(
  iconPath: string,
  title: string,
  action: string,
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = "mermaid-control-btn"
  btn.setAttribute("data-action", action)
  btn.setAttribute("title", title)
  btn.setAttribute("aria-label", title)
  btn.appendChild(createSvgIcon(iconPath))
  return btn
}

function createDivider(): HTMLSpanElement {
  const span = document.createElement("span")
  span.className = "mermaid-divider"
  return span
}

function createControls(): HTMLDivElement {
  const bar = document.createElement("div")
  bar.className = "mermaid-controls"

  bar.appendChild(createControlButton(icons.zoomIn, "Zoom in", "zoom-in"))
  bar.appendChild(createControlButton(icons.zoomOut, "Zoom out", "zoom-out"))
  bar.appendChild(createControlButton(icons.reset, "Reset view", "zoom-reset"))
  bar.appendChild(createDivider())
  bar.appendChild(
    createControlButton(icons.fullscreen, "Fullscreen", "fullscreen"),
  )
  bar.appendChild(createControlButton(icons.download, "Download", "download"))
  bar.appendChild(
    createControlButton(icons.copy, "Copy source", "copy-source"),
  )

  return bar
}

function createDownloadMenu(): HTMLDivElement {
  const menu = document.createElement("div")
  menu.className = "mermaid-download-menu"
  menu.style.display = "none"

  const items = [
    { format: "svg", label: "Download SVG" },
    { format: "png", label: "Download PNG" },
    { format: "mmd", label: "Download source (.mmd)" },
  ]

  for (const item of items) {
    const btn = document.createElement("button")
    btn.className = "mermaid-download-item"
    btn.setAttribute("data-format", item.format)
    btn.textContent = item.label
    menu.appendChild(btn)
  }

  return menu
}

// ============================================================
// Download helpers
// ============================================================

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadSvg(svgContent: string) {
  const blob = new Blob([svgContent], { type: "image/svg+xml" })
  downloadBlob(blob, "diagram.svg")
}

function downloadMmd(source: string) {
  const blob = new Blob([source], { type: "text/plain" })
  downloadBlob(blob, "diagram.mmd")
}

async function downloadPng(svgContent: string) {
  return new Promise<void>((resolve, reject) => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgContent, "image/svg+xml")
    const svgEl = doc.querySelector("svg")
    if (!svgEl) {
      reject(new Error("No SVG element found"))
      return
    }

    // Get SVG dimensions
    const width =
      parseFloat(svgEl.getAttribute("width") || "800") ||
      svgEl.viewBox?.baseVal?.width ||
      800
    const height =
      parseFloat(svgEl.getAttribute("height") || "600") ||
      svgEl.viewBox?.baseVal?.height ||
      600

    const scale = 5
    const canvas = document.createElement("canvas")
    canvas.width = width * scale
    canvas.height = height * scale

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      reject(new Error("Cannot create canvas context"))
      return
    }

    const img = new Image()
    const svgBase64 = btoa(unescape(encodeURIComponent(svgContent)))
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, "diagram.png")
          resolve()
        } else {
          reject(new Error("Failed to create PNG blob"))
        }
      }, "image/png")
    }
    img.onerror = () => reject(new Error("Failed to load SVG as image"))
    img.src = `data:image/svg+xml;base64,${svgBase64}`
  })
}

// ============================================================
// Fullscreen
// ============================================================

/**
 * Fix fullscreen SVG sizing: mermaid outputs width="100%" which collapses
 * to 0 in a pure flex layout. Replace percentage width with the actual
 * viewBox dimensions and constrain with CSS max-width/max-height.
 */
function fixSvgSizing(container: HTMLElement) {
  const svgEl = container.querySelector("svg")
  if (!svgEl) return
  const viewBox = svgEl.getAttribute("viewBox")
  if (viewBox) {
    const parts = viewBox.split(/\s+/)
    const vbWidth = parseFloat(parts[2])
    const vbHeight = parseFloat(parts[3])
    if (vbWidth) svgEl.setAttribute("width", String(vbWidth))
    if (vbHeight) svgEl.setAttribute("height", String(vbHeight))
  }
  svgEl.style.maxWidth = "90vw"
  svgEl.style.maxHeight = "85vh"
  svgEl.style.width = "auto"
  svgEl.style.height = "auto"
}

/**
 * Open fullscreen view by re-rendering the diagram via mermaid.render()
 * with a fresh unique ID, completely avoiding DOM ID / CSS selector
 * conflicts with the inline SVG.
 */
async function openFullscreen(source: string) {
  // Re-render an independent SVG for fullscreen
  let fullscreenSvg: string
  try {
    const mermaid = await loadMermaid()
    const id = generateId()
    const result = await mermaid.render(id, source)
    fullscreenSvg = result.svg
  } catch {
    // Render failed, don't open fullscreen
    return
  }

  const overlay = document.createElement("div")
  overlay.className = "mermaid-fullscreen-overlay"

  // Lock body scroll
  const scrollY = window.scrollY
  document.body.style.overflow = "hidden"
  document.body.style.position = "fixed"
  document.body.style.top = `-${scrollY}px`
  document.body.style.width = "100%"

  // Independent zoom/pan state for fullscreen
  const state: PanZoomState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  }

  // Viewport + transform layer
  const viewport = document.createElement("div")
  viewport.className = "mermaid-fullscreen-viewport"

  const transformEl = document.createElement("div")
  transformEl.className = "mermaid-transform"
  transformEl.innerHTML = fullscreenSvg
  fixSvgSizing(transformEl)

  applyTransform(transformEl, state)

  viewport.appendChild(transformEl)

  // Fullscreen control bar
  const controls = document.createElement("div")
  controls.className = "mermaid-fullscreen-controls"
  controls.appendChild(createControlButton(icons.zoomIn, "Zoom in", "zoom-in"))
  controls.appendChild(
    createControlButton(icons.zoomOut, "Zoom out", "zoom-out"),
  )
  controls.appendChild(
    createControlButton(icons.reset, "Reset view", "zoom-reset"),
  )
  controls.appendChild(createDivider())
  controls.appendChild(createControlButton(icons.download, "Download", "download"))
  controls.appendChild(
    createControlButton(icons.copy, "Copy source", "copy-source"),
  )

  // Close button
  const closeBtn = document.createElement("button")
  closeBtn.className = "mermaid-fullscreen-close"
  closeBtn.setAttribute("title", "Close (Esc)")
  closeBtn.setAttribute("aria-label", "Close fullscreen")
  closeBtn.appendChild(createSvgIcon(icons.close))

  // Download menu
  const downloadMenu = createDownloadMenu()
  downloadMenu.className += " mermaid-fullscreen-download-menu"

  overlay.appendChild(viewport)
  overlay.appendChild(controls)
  overlay.appendChild(closeBtn)
  overlay.appendChild(downloadMenu)
  document.body.appendChild(overlay)

  // Close handler
  const close = () => {
    document.body.removeChild(overlay)
    document.body.style.overflow = ""
    document.body.style.position = ""
    document.body.style.top = ""
    document.body.style.width = ""
    window.scrollTo(0, scrollY)
    document.removeEventListener("keydown", handleKey)
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  }
  document.addEventListener("keydown", handleKey)
  closeBtn.addEventListener("click", close)

  // Click overlay background to close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close()
  })

  // Bind zoom/pan events
  setupPanZoom(viewport, transformEl, state)
  setupControlActions(
    overlay,
    transformEl,
    state,
    fullscreenSvg,
    source,
    downloadMenu,
  )
}

// ============================================================
// Pan & zoom event bindings
// ============================================================

function setupPanZoom(
  viewport: HTMLElement,
  transformEl: HTMLElement,
  state: PanZoomState,
) {
  // Wheel zoom
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      state.zoom = clampZoom(state.zoom + delta)
      applyTransform(transformEl, state)
      updateZoomButtons(viewport.closest("[data-component='mermaid-diagram']") || viewport.closest(".mermaid-fullscreen-overlay"), state)
    },
    { passive: false },
  )

  // Drag to pan
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return
    state.isPanning = true
    state.startX = e.clientX
    state.startY = e.clientY
    state.startPanX = state.panX
    state.startPanY = state.panY
    viewport.setPointerCapture(e.pointerId)
    viewport.style.cursor = "grabbing"
  })

  viewport.addEventListener("pointermove", (e) => {
    if (!state.isPanning) return
    state.panX = state.startPanX + (e.clientX - state.startX)
    state.panY = state.startPanY + (e.clientY - state.startY)
    applyTransform(transformEl, state)
  })

  const endPan = () => {
    state.isPanning = false
    viewport.style.cursor = "grab"
  }
  viewport.addEventListener("pointerup", endPan)
  viewport.addEventListener("pointercancel", endPan)
}

function updateZoomButtons(
  container: Element | null,
  state: PanZoomState,
) {
  if (!container) return
  const zoomIn = container.querySelector(
    '[data-action="zoom-in"]',
  ) as HTMLButtonElement | null
  const zoomOut = container.querySelector(
    '[data-action="zoom-out"]',
  ) as HTMLButtonElement | null
  if (zoomIn) zoomIn.disabled = state.zoom >= MAX_ZOOM
  if (zoomOut) zoomOut.disabled = state.zoom <= MIN_ZOOM
}

// ============================================================
// Control action bindings
// ============================================================

function setupControlActions(
  container: HTMLElement,
  transformEl: HTMLElement,
  state: PanZoomState,
  svgContent: string,
  source: string,
  downloadMenu: HTMLElement,
) {
  container.addEventListener("click", async (e) => {
    const target = e.target as Element
    const btn = target.closest("[data-action]") as HTMLElement | null
    const menuItem = target.closest("[data-format]") as HTMLElement | null

    if (menuItem) {
      const format = menuItem.getAttribute("data-format")
      downloadMenu.style.display = "none"
      try {
        if (format === "svg") downloadSvg(svgContent)
        else if (format === "png") await downloadPng(svgContent)
        else if (format === "mmd") downloadMmd(source)
      } catch {
        // Silently handle download failure
      }
      return
    }

    if (!btn) return
    const action = btn.getAttribute("data-action")

    switch (action) {
      case "zoom-in":
        state.zoom = clampZoom(state.zoom + ZOOM_STEP)
        applyTransform(transformEl, state)
        updateZoomButtons(container, state)
        break
      case "zoom-out":
        state.zoom = clampZoom(state.zoom - ZOOM_STEP)
        applyTransform(transformEl, state)
        updateZoomButtons(container, state)
        break
      case "zoom-reset":
        state.zoom = 1
        state.panX = 0
        state.panY = 0
        applyTransform(transformEl, state)
        updateZoomButtons(container, state)
        break
      case "fullscreen":
        // Only inline view has the fullscreen button; re-render to avoid ID conflicts
        await openFullscreen(source)
        break
      case "download":
        // Toggle download menu visibility
        downloadMenu.style.display =
          downloadMenu.style.display === "none" ? "" : "none"
        break
      case "copy-source": {
        try {
          await navigator.clipboard.writeText(source)
          // Show copied feedback by swapping icon temporarily
          const svgEl = btn.querySelector("svg")
          if (svgEl) {
            const original = svgEl.innerHTML
            svgEl.innerHTML = icons.check
            btn.setAttribute("data-copied", "true")
            setTimeout(() => {
              svgEl.innerHTML = original
              btn.removeAttribute("data-copied")
            }, 2000)
          }
        } catch {
          // Silently handle clipboard unavailability
        }
        break
      }
    }
  })

  // Close download menu on outside click
  document.addEventListener("click", (e) => {
    if (downloadMenu.style.display === "none") return
    const target = e.target as Element
    if (
      !downloadMenu.contains(target) &&
      !target.closest('[data-action="download"]')
    ) {
      downloadMenu.style.display = "none"
    }
  })
}

// ============================================================
// Build rendered DOM structure
// ============================================================

function buildRenderedDOM(
  container: HTMLElement,
  svgContent: string,
  source: string,
) {
  // Viewport + transform layer
  const viewport = document.createElement("div")
  viewport.className = "mermaid-viewport"

  const transformEl = document.createElement("div")
  transformEl.className = "mermaid-transform"
  transformEl.innerHTML = svgContent
  viewport.appendChild(transformEl)

  // Control bar
  const controls = createControls()
  const downloadMenu = createDownloadMenu()

  // Zoom/pan state
  const state: PanZoomState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  }

  // Hide source pre (kept for copy functionality)
  const pre = container.querySelector("pre")
  if (pre) pre.style.display = "none"

  // Insert at the beginning of container
  container.insertBefore(downloadMenu, container.firstChild)
  container.insertBefore(controls, container.firstChild)
  container.insertBefore(viewport, container.firstChild)

  container.setAttribute("data-mermaid-rendered", "true")

  // Set up interactions
  setupPanZoom(viewport, transformEl, state)
  setupControlActions(
    container,
    transformEl,
    state,
    svgContent,
    source,
    downloadMenu,
  )
}

function buildErrorDOM(container: HTMLElement, error: unknown) {
  const errorBar = document.createElement("div")
  errorBar.className = "mermaid-error-bar"
  errorBar.textContent = `Mermaid rendering error: ${error instanceof Error ? error.message : String(error)}`
  container.insertBefore(errorBar, container.firstChild)
  container.setAttribute("data-mermaid-rendered", "true")
  container.setAttribute("data-mermaid-error", "true")
}

// ============================================================
// Main entry: render all unprocessed mermaid diagrams
// ============================================================

export async function renderMermaidDiagrams(root: HTMLElement) {
  const containers = root.querySelectorAll(
    '[data-component="mermaid-diagram"]:not([data-mermaid-rendered])',
  )
  if (containers.length === 0) return

  const mermaid = await loadMermaid()

  for (const container of containers) {
    const codeEl = container.querySelector("code")
    if (!codeEl) continue

    const source = codeEl.textContent ?? ""
    if (!source.trim()) continue

    try {
      const id = generateId()
      const { svg } = await mermaid.render(id, source)
      buildRenderedDOM(container as HTMLElement, svg, source)
    } catch (error) {
      buildErrorDOM(container as HTMLElement, error)
    }
  }
}
