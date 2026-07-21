import { createSignal } from "solid-js"
import { mermaidThemeCss, mermaidThemeVariables } from "./markdown-mermaid-theme"

export type MermaidColorScheme = "light" | "dark"

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string }

export function isMermaidLanguage(language: string | undefined) {
  return language?.trim().toLowerCase() === "mermaid"
}

// Camera over the diagram canvas: a content point p renders at p * zoom + (x, y).
export type MermaidCamera = { zoom: number; x: number; y: number }

export function clampMermaidZoom(zoom: number) {
  return Math.min(8, Math.max(0.1, zoom))
}

export function stepMermaidZoom(zoom: number, direction: 1 | -1) {
  return clampMermaidZoom(direction > 0 ? zoom * 1.25 : zoom / 1.25)
}

// Fill the padded canvas and center the diagram; vector output stays crisp when upscaled,
// matching zoom-to-fit in design tools.
export function fitMermaidCamera(
  natural: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 48,
): MermaidCamera {
  if (natural.width <= 0 || natural.height <= 0) return { zoom: 1, x: 0, y: 0 }
  const zoom = clampMermaidZoom(
    Math.min((viewport.width - padding * 2) / natural.width, (viewport.height - padding * 2) / natural.height),
  )
  return {
    zoom,
    x: (viewport.width - natural.width * zoom) / 2,
    y: (viewport.height - natural.height * zoom) / 2,
  }
}

// Keeps the content under `point` stationary while zooming, like canvas tools.
export function zoomMermaidCamera(
  camera: MermaidCamera,
  zoom: number,
  point: { x: number; y: number },
): MermaidCamera {
  const next = clampMermaidZoom(zoom)
  const ratio = next / camera.zoom
  return { zoom: next, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio }
}

// Mermaid measures text in-document, but theme values must be concrete, so the app font
// token resolves once here instead of passing the CSS variable through.
function appFontFamily() {
  const fallback = "ui-sans-serif, system-ui, sans-serif"
  if (typeof document !== "object") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim()
  return value || fallback
}

function readColorScheme(): MermaidColorScheme {
  if (typeof document !== "object") return "light"
  const scheme = document.documentElement.dataset.colorScheme
  if (scheme === "dark" || scheme === "light") return scheme
  if (typeof window === "object" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark"
  return "light"
}

const [colorScheme, setColorScheme] = createSignal<MermaidColorScheme>(readColorScheme())
let observing = false

// Reading this inside a reactive scope re-renders diagrams when the app theme flips.
export function mermaidColorScheme() {
  if (!observing && typeof document === "object") {
    observing = true
    new MutationObserver(() => setColorScheme(readColorScheme())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    })
  }
  return colorScheme()
}

let loader: Promise<typeof import("mermaid").default> | undefined
let initializedScheme: MermaidColorScheme | undefined
let sequence = 0
// Mermaid keeps a single global config and appends scratch nodes to the document while
// measuring text, so renders must run one at a time to avoid clobbering each other.
let queue: Promise<unknown> = Promise.resolve()

async function load(scheme: MermaidColorScheme) {
  loader ??= import("mermaid").then((module) => module.default)
  const mermaid = await loader
  if (initializedScheme !== scheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: { ...mermaidThemeVariables(scheme), fontFamily: appFontFamily(), fontSize: "14px" },
      themeCSS: mermaidThemeCss(scheme),
    })
    initializedScheme = scheme
  }
  return mermaid
}

export function renderMermaid(source: string, scheme: MermaidColorScheme): Promise<MermaidRenderResult> {
  // The runner converts every failure into a result, so the queue never rejects.
  const result = queue.then(async (): Promise<MermaidRenderResult> => {
    try {
      const mermaid = await load(scheme)
      const { svg } = await mermaid.render(`mermaid-diagram-${++sequence}`, source)
      return { ok: true, svg }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  queue = result
  return result
}
