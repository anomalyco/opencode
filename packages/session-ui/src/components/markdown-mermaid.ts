import { createSignal } from "solid-js"

export type MermaidColorScheme = "light" | "dark"

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string }

export function isMermaidLanguage(language: string | undefined) {
  return language?.trim().toLowerCase() === "mermaid"
}

export function clampMermaidZoom(zoom: number) {
  return Math.min(8, Math.max(0.25, zoom))
}

export function stepMermaidZoom(zoom: number, direction: 1 | -1) {
  return clampMermaidZoom(direction > 0 ? zoom * 1.25 : zoom / 1.25)
}

// Fit the diagram inside the viewport without ever upscaling past its natural size.
export function fitMermaidZoom(natural: { width: number; height: number }, viewport: { width: number; height: number }) {
  if (natural.width <= 0 || natural.height <= 0) return 1
  return clampMermaidZoom(Math.min(1, viewport.width / natural.width, viewport.height / natural.height))
}

export function mermaidThemeFor(scheme: MermaidColorScheme) {
  return scheme === "dark" ? "dark" : "default"
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
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: mermaidThemeFor(scheme) })
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
