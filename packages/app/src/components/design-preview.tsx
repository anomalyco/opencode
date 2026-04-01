import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { usePlatform } from "@/context/platform"
import { detectDevUrl } from "@/utils/detect-port"
import { createInjectionScript } from "@/components/design-preview/injection"

const INJECT = createInjectionScript()

export type DesignElementInfo = {
  tag: string
  id?: string
  classes?: string
  component?: string
  textContent?: string
  ancestry?: string[]
  path: string
  rect: { x: number; y: number; width: number; height: number }
  computedStyles?: Record<string, string>
  source?: { file?: string; line?: number; column?: number; component?: string; _debug?: string[] }
  searchHint?: string[]
  summary?: string
  framework?: string
}

type Viewport = "desktop" | "tablet" | "mobile"

const VIEWPORTS: Record<Viewport, { width: number; height: number; label: string } | null> = {
  desktop: null,
  tablet: { width: 768, height: 1024, label: "Tablet" },
  mobile: { width: 375, height: 812, label: "Mobile" },
}

export type DesignPreviewProps = {
  onOpenFile?: (path: string, line: number) => void
  onElementSelect?: (info: DesignElementInfo | undefined) => void
  onComment?: (input: { file: string; line: number; comment: string; component?: string }) => void
}

type Note = {
  text: string
  element: {
    tagName: string
    className?: string
    domPath: string
    sourceFile?: string
    sourceLine?: number
    boundingRect: DesignElementInfo["rect"]
  }
}

type Hit = {
  file: string
  line: number
  comp?: string
}

export function DesignPreview(props: DesignPreviewProps) {
  const files = useFile()
  const layout = useLayout()
  const sdk = useSDK()
  const platform = usePlatform()

  let container: HTMLDivElement | undefined
  let placeholder: HTMLDivElement | undefined
  let health: ReturnType<typeof setInterval> | undefined
  let poller: ReturnType<typeof setInterval> | undefined
  let observer: ResizeObserver | undefined
  let lastCmd = 0
  let webviewOpen = false
  let raf = 0
  let picked = 0
  const changed = new Set<string>()
  let change: ReturnType<typeof setTimeout> | undefined
  let poke: ReturnType<typeof setTimeout> | undefined
  let push: ReturnType<typeof setTimeout> | undefined
  let reopen: ReturnType<typeof setTimeout> | undefined
  let listed = ""
  let sent = ""

  const [store, setStore] = createStore({
    viewport: "desktop" as Viewport,
    size: undefined as { width: number; height: number; label: string } | undefined,
    status: "disconnected" as "connected" | "disconnected" | "loading",
    detecting: false,
    framework: undefined as string | undefined,
    selected: undefined as DesignElementInfo | undefined,
    inspect: true,
    notes: [] as Note[],
  })

  const [url, setUrl] = createSignal(layout.design.url())
  const [input, setInput] = createSignal(layout.design.url())

  const active = createMemo(() => !!store.size || store.viewport !== "desktop")
  const preset = createMemo(() => store.size ?? VIEWPORTS[store.viewport])
  const supported = createMemo(() => !!platform.createDesignWebview)

  const syncInspect = () => {
    if (!webviewOpen) return
    platform.evalDesignWebview?.(
      `window.__opencode_set_inspect_mode && window.__opencode_set_inspect_mode(${store.inspect})`,
    )
  }

  const getRect = () => {
    if (!placeholder) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = placeholder.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }

  const GAP = 8

  const openWebview = async (target: string) => {
    if (!platform.createDesignWebview) return
    const r = getRect()
    if (r.width <= 0 || r.height <= 0) return
    await platform.createDesignWebview(target, r.x, r.y, r.width - GAP, r.height, INJECT)
    webviewOpen = true
    listed = ""
    setStore("status", "connected")
    syncSize()
    setTimeout(() => {
      sendWhitelist()
      syncInspect()
    }, 500)
  }

  const closeWebview = async () => {
    if (!webviewOpen) return
    webviewOpen = false
    await platform.closeDesignWebview?.()
  }

  const syncSizeNow = () => {
    raf = 0
    if (!webviewOpen || !platform.resizeDesignWebview) return
    const r = getRect()
    if (r.width <= 0 || r.height <= 0) return
    platform.resizeDesignWebview(r.x, r.y, r.width - GAP, r.height)
  }

  const syncSize = () => {
    if (raf) return
    raf = requestAnimationFrame(syncSizeNow)
  }

  const load = async (target: string) => {
    if (!target) return
    changed.clear()
    if (poke) clearTimeout(poke)
    if (reopen) clearTimeout(reopen)
    if (target !== url()) {
      setStore("selected", undefined)
      setStore("notes", [])
    }
    setUrl(target)
    layout.design.setUrl(target)
    await closeWebview()
    await openWebview(target)
  }

  const refresh = async () => {
    const target = url()
    if (!target) return
    changed.clear()
    if (poke) clearTimeout(poke)
    if (reopen) clearTimeout(reopen)
    await closeWebview()
    await openWebview(target)
  }

  const disconnect = async () => {
    changed.clear()
    if (poke) clearTimeout(poke)
    if (reopen) clearTimeout(reopen)
    await closeWebview()
    setUrl("")
    setInput("")
    layout.design.setUrl("")
    setStore("status", "disconnected")
    setStore("framework", undefined)
    setStore("selected", undefined)
    setStore("notes", [])
  }

  const submit = (e: Event) => {
    e.preventDefault()
    const val = input().trim()
    if (!val) return
    const target = val.startsWith("http") ? val : `http://${val}`
    load(target)
  }

  const detect = async () => {
    setStore("detecting", true)
    const result = await detectDevUrl(sdk.directory, sdk.client).catch(() => null)
    setStore("detecting", false)
    if (!result) return
    setStore("framework", result.framework)
    setInput(result.url)
    load(result.url)
  }

  const check = async () => {
    const target = url()
    if (!target) {
      setStore("status", "disconnected")
      return
    }
    try {
      await fetch(target, { method: "HEAD", mode: "no-cors" })
      if (store.status === "disconnected") setStore("status", "connected")
    } catch {
      setStore("status", "disconnected")
    }
  }

  const parsePayload = (e: { payload: string | DesignElementInfo }): DesignElementInfo | undefined => {
    if (!e.payload) return undefined
    if (typeof e.payload === "string") {
      try {
        return JSON.parse(e.payload)
      } catch {
        return undefined
      }
    }
    return e.payload
  }

  const note = (info: DesignElementInfo, text: string): Note => ({
    text,
    element: {
      tagName: info.tag,
      className: info.classes,
      domPath: info.path,
      sourceFile: info.source?.file ? normalizePath(info.source.file) : undefined,
      sourceLine: info.source?.line,
      boundingRect: info.rect,
    },
  })

  const GENERIC_CLASSES = new Set([
    "flex",
    "flex-1",
    "flex-col",
    "flex-row",
    "flex-wrap",
    "flex-none",
    "flex-auto",
    "grid",
    "block",
    "inline",
    "inline-flex",
    "inline-block",
    "hidden",
    "contents",
    "relative",
    "absolute",
    "fixed",
    "sticky",
    "w-full",
    "w-auto",
    "h-full",
    "h-auto",
    "w-screen",
    "h-screen",
    "p-0",
    "p-1",
    "p-2",
    "p-3",
    "p-4",
    "p-5",
    "p-6",
    "p-8",
    "p-10",
    "p-12",
    "p-16",
    "px-0",
    "px-1",
    "px-2",
    "px-3",
    "px-4",
    "px-5",
    "px-6",
    "px-8",
    "py-0",
    "py-1",
    "py-2",
    "py-3",
    "py-4",
    "py-5",
    "py-6",
    "py-8",
    "pt-0",
    "pb-0",
    "pl-0",
    "pr-0",
    "m-0",
    "m-1",
    "m-2",
    "m-3",
    "m-4",
    "m-auto",
    "mx-0",
    "mx-auto",
    "my-0",
    "my-auto",
    "mt-0",
    "mb-0",
    "ml-0",
    "mr-0",
    "text-xs",
    "text-sm",
    "text-base",
    "text-lg",
    "text-xl",
    "text-2xl",
    "text-3xl",
    "text-4xl",
    "font-normal",
    "font-medium",
    "font-semibold",
    "font-bold",
    "text-left",
    "text-center",
    "text-right",
    "rounded",
    "rounded-sm",
    "rounded-md",
    "rounded-lg",
    "rounded-xl",
    "rounded-full",
    "rounded-none",
    "border",
    "border-0",
    "border-t",
    "border-b",
    "border-l",
    "border-r",
    "shadow",
    "shadow-sm",
    "shadow-md",
    "shadow-lg",
    "shadow-none",
    "overflow-hidden",
    "overflow-auto",
    "overflow-scroll",
    "overflow-visible",
    "items-start",
    "items-center",
    "items-end",
    "items-stretch",
    "justify-start",
    "justify-center",
    "justify-end",
    "justify-between",
    "justify-around",
    "gap-0",
    "gap-1",
    "gap-2",
    "gap-3",
    "gap-4",
    "gap-5",
    "gap-6",
    "gap-8",
    "cursor-pointer",
    "cursor-default",
    "cursor-not-allowed",
    "opacity-0",
    "opacity-50",
    "opacity-100",
    "transition",
    "duration-150",
    "duration-200",
    "duration-300",
    "ease-in",
    "ease-out",
    "container",
    "group",
    "peer",
    "sr-only",
    "not-sr-only",
    "min-w-0",
    "min-h-0",
    "max-w-full",
    "max-h-full",
    "z-0",
    "z-10",
    "z-20",
    "z-50",
    "z-auto",
    "top-0",
    "bottom-0",
    "left-0",
    "right-0",
    "inset-0",
    "truncate",
    "whitespace-nowrap",
    "whitespace-pre",
    "list-none",
    "list-disc",
    "list-decimal",
    "pointer-events-none",
    "pointer-events-auto",
    "select-none",
    "select-text",
    "select-all",
    "appearance-none",
    "outline-none",
    "ring-0",
    "disabled",
    "active",
    "hover",
    "focus",
    "dark",
  ])

  const pickClasses = (classes: string | undefined): string[] => {
    if (!classes) return []
    const parts = classes
      .trim()
      .split(/\s+/)
      .filter((c) => {
        if (!c || c.length < 3) return false
        if (GENERIC_CLASSES.has(c)) return false
        // Skip pure color/sizing utilities
        if (/^(bg|text|border|ring|fill|stroke)-(transparent|current|inherit|white|black)$/.test(c)) return false
        if (/^(w|h|min-w|min-h|max-w|max-h)-\d/.test(c)) return false
        if (
          /^(text|bg|border)-(gray|red|blue|green|yellow|purple|pink|indigo|orange|teal|cyan|emerald|violet|rose|lime|sky|amber|fuchsia|slate|zinc|neutral|stone)-\d+$/.test(
            c,
          )
        )
          return false
        if (/^(p|m)[trblxy]?-\d+$/.test(c)) return false
        if (/^gap-\d+$/.test(c)) return false
        return true
      })
    // Prefer longer/more-specific class names
    return parts.sort((a, b) => b.length - a.length).slice(0, 3)
  }

  const normalizePath = (file: string): string => {
    return files.normalize(
      file
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/^turbopack:\/\/\[project\]\//, "")
        .replace(/^webpack-internal:\/\/\/\.?\//, "")
        .replace(/^webpack:\/\/\/\.?\//, "")
        .replace(/^webpack:\/\/[^/]*\/\.?\//, "")
        .replace(/^\(.*?\)\/\.?\//, "")
        .replace(/^\/@fs/, "")
        .replace(/^\/@(id|vite)\//, "")
        .replace(/\\/g, "/"),
    )
  }

  const isSourceFile = (path: string): boolean => {
    const name = path.split("/").pop() ?? ""
    if (path.includes("node_modules/") || path.includes("node_modules\\")) return false
    if (path.includes(".vite/deps/") || path.includes(".vite/chunks/")) return false
    if (path.includes(".pnpm/") || path.includes(".yarn/cache")) return false
    if (/^[0-9a-f]{4,}\.(js|mjs)$/.test(name)) return false
    if (/\.[0-9a-f]{6,}\.(js|mjs)$/.test(name)) return false
    if (/^(main|app|vendor|framework|commons|webpack|polyfills?)-[0-9a-f]+\.(js|mjs)$/.test(name)) return false
    if (path.includes("static/chunks/") || path.includes("_next/") || path.includes(".next/")) return false
    if (path.includes("/build/static/")) return false
    if (/\.(tsx?|jsx?|vue|svelte|astro|html)$/.test(name)) return true
    if (/\.(js|mjs)$/.test(name) && (path.includes("/dist/") || path.includes("/build/"))) return false
    return true
  }

  const isUserFile = (path: string) =>
    !path.includes("node_modules/") &&
    !path.includes("node_modules\\") &&
    !path.includes(".vite/deps/") &&
    !path.includes(".vite/chunks/") &&
    !path.includes(".pnpm/") &&
    !path.includes(".yarn/cache") &&
    /\.(tsx|jsx|ts|js|vue|svelte|html)$/.test(path)

  let rustNames: string[] = []

  const sendWhitelist = () => {
    if (!webviewOpen) return
    const json = JSON.stringify(rustNames)
    if (json === listed) return
    listed = json
    platform.evalDesignWebview?.(
      `window.__opencode_set_user_components && window.__opencode_set_user_components(${json})`,
    )
  }

  const applyNames = (names: string[] | null | undefined, label: string) => {
    resetCache()
    rustNames = names ?? []
    if (names?.length) {
      console.log(`[Design] Rust index ${label}:`, names.length, "components")
    }
    sendWhitelist()
  }

  const buildIndex = async () => {
    if (!platform.buildDesignIndex) return
    const root = sdk.directory
    if (!root) return
    const names = await platform.buildDesignIndex(root).catch(() => null)
    applyNames(names, "built")
  }

  const updateIndex = async (paths: string[]) => {
    if (!paths.length) return
    if (!platform.updateDesignIndex) {
      await buildIndex()
      return
    }
    const root = sdk.directory
    if (!root) return
    const names = await platform.updateDesignIndex(root, paths).catch(() => null)
    if (!names) {
      await buildIndex()
      return
    }
    applyNames(names, "updated")
  }

  const idxCache = new Map<string, Hit | null>()
  const idxRun = new Map<string, Promise<Hit | null>>()
  const textCache = new Map<string, Hit | null>()
  const textRun = new Map<string, Promise<Hit | null>>()
  const defRun = new Map<string, Promise<Hit | null>>()
  const useRun = new Map<string, Promise<Hit | null>>()
  let cache = 0

  const queryIndex = async (comp: string | null | undefined, classes: string | undefined): Promise<Hit | null> => {
    if (!platform.queryDesignIndex) return null
    const root = sdk.directory
    if (!root) return null
    const key = `${root}\n${comp ?? ""}\n${classes ?? ""}`
    if (idxCache.has(key)) return idxCache.get(key) ?? null
    const pending = idxRun.get(key)
    if (pending) return pending
    const cls = pickClasses(classes)
    const ver = cache
    const run = platform
      .queryDesignIndex(root, comp ?? null, cls.length ? cls : null)
      .then(
        (result) => {
          if (ver !== cache) return null
          if (result && result.confidence > 0.3) {
            console.log("[Design] Rust index hit:", result.file, "line:", result.line, "confidence:", result.confidence)
            const hit = { file: result.file, line: result.line, comp: comp ?? undefined }
            idxCache.set(key, hit)
            return hit
          }
          idxCache.set(key, null)
          return null
        },
        () => {
          if (ver !== cache) return null
          idxCache.set(key, null)
          return null
        },
      )
      .finally(() => {
        idxRun.delete(key)
      })
    idxRun.set(key, run)
    return run
  }

  const setResolved = (info: DesignElementInfo, hit: Hit) => {
    const next = {
      ...info,
      component: hit.comp ?? info.component ?? info.source?.component,
      source: {
        ...info.source,
        file: hit.file,
        line: hit.line,
        component: hit.comp ?? info.component ?? info.source?.component,
      },
    } satisfies DesignElementInfo
    if (store.selected?.path === info.path) setStore("selected", next)
    return next
  }

  const openHit = (hit: Hit) => {
    props.onOpenFile?.(hit.file, hit.line)
    return true
  }

  const openResolved = (info: DesignElementInfo, hit: Hit) => {
    setResolved(info, hit)
    return openHit(hit)
  }

  const locate = async (info: DesignElementInfo): Promise<Hit | null> => {
    const comp = info.component ?? info.source?.component
    const idx = await queryIndex(comp, info.classes)
    if (idx) return idx
    const chain = info.ancestry ?? []
    for (const name of chain) {
      const next = await queryIndex(name, undefined)
      if (next) return next
      const def = await findDefinition(name)
      if (def) return def
    }
    return grepFallback(info)
  }

  const openComp = async (name: string) => {
    const idx = await queryIndex(name, undefined)
    if (idx) return openHit(idx)
    const def = await findDefinition(name)
    if (def) return openHit(def)
    const use = await findUsage(name)
    if (use) return openHit(use)
    return false
  }

  const defCache = new Map<string, Hit | null>()
  const usageCache = new Map<string, Hit | null>()

  const resetCache = () => {
    cache++
    idxCache.clear()
    idxRun.clear()
    defCache.clear()
    defRun.clear()
    usageCache.clear()
    useRun.clear()
    textCache.clear()
    textRun.clear()
  }

  const syncPreview = () => {
    if (!webviewOpen || !platform.evalDesignWebview) return Promise.resolve(false)
    return platform
      .evalDesignWebview(
        `window.__opencode_rebuild_map && window.__opencode_rebuild_map(); window.__opencode_sync && window.__opencode_sync();`,
      )
      .then(
        () => true,
        () => false,
      )
  }

  const queueSync = (delay = 700, tries = 2) => {
    if (poke) clearTimeout(poke)
    poke = setTimeout(() => {
      poke = undefined
      void syncPreview().then((ok) => {
        if (ok) {
          if (reopen) clearTimeout(reopen)
          reopen = undefined
          return
        }
        if (tries > 0) {
          queueSync(400, tries - 1)
          return
        }
        if (!url()) return
        if (reopen) clearTimeout(reopen)
        reopen = setTimeout(() => {
          reopen = undefined
          if (!url()) return
          void refresh()
        }, 1500)
      })
    }, delay)
  }

  const indexed = (path?: string) => {
    if (!path) return true
    return /\.(tsx|jsx|ts|js|vue|svelte)$/i.test(path)
  }

  const queueReindex = (path?: string) => {
    if (path) changed.add(path)
    if (change) clearTimeout(change)
    change = setTimeout(() => {
      const paths = [...changed]
      changed.clear()
      change = undefined
      const files = paths.filter(indexed)
      const run = !paths.length ? buildIndex() : files.length ? updateIndex(files) : Promise.resolve()
      void run.finally(() => {
        queueSync()
      })
    }, 250)
  }

  // Check if a source file likely *defines* the component (vs just rendering it)
  const fileDefinesComponent = (file: string, comp: string): boolean => {
    if (!comp) return true
    const name = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?|vue|svelte)$/, "")
    const lower = comp.toLowerCase()
    // header.tsx defines Header, use-header.ts defines Header hook, etc.
    if (name.toLowerCase() === lower) return true
    if (name.toLowerCase().replace(/[-_]/g, "") === lower) return true
    // index.tsx could define anything — accept it
    if (name === "index") return true
    // page.tsx, layout.tsx in Next.js are definitions
    if (["page", "layout", "template", "loading", "error", "not-found"].includes(name)) return true
    return false
  }

  // Search for the file where a component is defined (in user code, not node_modules)
  const findDefinition = async (comp: string): Promise<Hit | null> => {
    if (defCache.has(comp)) {
      return defCache.get(comp) ?? null
    }
    const pending = defRun.get(comp)
    if (pending) return pending
    const patterns = [`function ${comp}`, `const ${comp}`, `export default function ${comp}`, `export function ${comp}`]
    const ver = cache
    const run = (async () => {
      for (const pattern of patterns) {
        const res = await sdk.client.find.text({ pattern }).catch(() => null)
        if (ver !== cache) return null
        const hits = res?.data ?? []
        if (!hits.length) continue

        const user = hits.filter((m) => isUserFile(m.path.text))
        const exact = user.find((m) => {
          const fname = (m.path.text.split("/").pop() ?? "").replace(/\.(tsx?|jsx?|vue|svelte)$/, "")
          return (
            fname.toLowerCase() === comp.toLowerCase() ||
            fname.toLowerCase().replace(/[-_]/g, "") === comp.toLowerCase()
          )
        })
        const match = exact ?? user[0]
        if (match?.path.text) {
          const line = match.line_number ?? 1
          const hit = { file: match.path.text, line, comp }
          defCache.set(comp, hit)
          console.log("[Design] Found definition of", comp, "at:", match.path.text, "line:", line, "via:", pattern)
          return hit
        }
      }
      defCache.set(comp, null)
      return null
    })().finally(() => {
      defRun.delete(comp)
    })
    defRun.set(comp, run)
    return run
  }

  // Search for where a component is *used* in JSX (for library components like icons)
  const findUsage = async (comp: string): Promise<Hit | null> => {
    if (usageCache.has(comp)) {
      return usageCache.get(comp) ?? null
    }
    const pending = useRun.get(comp)
    if (pending) return pending
    const ver = cache
    const run = sdk.client.find
      .text({ pattern: `<${comp}` })
      .then(
        (res) => {
          if (ver !== cache) return null
          const hits = res.data ?? []
          const user = hits.filter((m) => isUserFile(m.path.text))
          const match = user[0]
          if (match?.path.text) {
            const line = match.line_number ?? 1
            const hit = { file: match.path.text, line, comp }
            usageCache.set(comp, hit)
            console.log("[Design] Found usage of <" + comp + "> at:", match.path.text, "line:", line)
            return hit
          }
          usageCache.set(comp, null)
          return null
        },
        () => {
          if (ver !== cache) return null
          usageCache.set(comp, null)
          return null
        },
      )
      .finally(() => {
        useRun.delete(comp)
      })
    useRun.set(comp, run)
    return run
  }

  // Search by text content in user source files
  const findByText = async (text: string): Promise<Hit | null> => {
    if (!text || text.length < 4) return null
    if (textCache.has(text)) return textCache.get(text) ?? null
    const pending = textRun.get(text)
    if (pending) return pending
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const ver = cache
    const run = sdk.client.find
      .text({ pattern: escaped })
      .then(
        (res) => {
          if (ver !== cache) return null
          const hits = res.data ?? []
          if (!hits.length) {
            textCache.set(text, null)
            return null
          }

          const match = hits.find((m) => isUserFile(m.path.text))
          if (match?.path.text) {
            console.log("[Design] Found by text content:", match.path.text, "line:", match.line_number)
            const hit = { file: match.path.text, line: match.line_number ?? 1 }
            textCache.set(text, hit)
            return hit
          }
          textCache.set(text, null)
          return null
        },
        () => {
          if (ver !== cache) return null
          textCache.set(text, null)
          return null
        },
      )
      .finally(() => {
        textRun.delete(text)
      })
    textRun.set(text, run)
    return run
  }

  const grepFallback = async (info: DesignElementInfo): Promise<Hit | null> => {
    const comp = info.component ?? info.source?.component

    // 1. Try component definition search in user code
    if (comp) {
      const def = await findDefinition(comp)
      if (def) return def
    }

    // 2. Try JSX usage search (for library components: icons, UI libs)
    if (comp) {
      const use = await findUsage(comp)
      if (use) return use
    }

    // 3. Try text content search
    if (info.textContent) {
      const text = await findByText(info.textContent)
      if (text) return text
    }

    // 4. Fall back to search hints and CSS classes
    const terms: string[] = []
    const hints = info.searchHint ?? []
    for (const h of hints) {
      if (h.startsWith("#")) continue
      if (h.length > 2 && !terms.includes(h)) terms.push(h)
    }
    const classes = pickClasses(info.classes)
    for (const c of classes) {
      if (!terms.includes(c)) terms.push(c)
    }
    if (!terms.length) return null

    for (const term of terms) {
      const res = await sdk.client.find.text({ pattern: term }).catch(() => null)
      const hits = res?.data ?? []
      if (!hits.length) continue

      const match = hits.find((m) => isUserFile(m.path.text))
      if (match?.path.text) {
        console.log("[Design] grep fallback found:", match.path.text, "via term:", term)
        return { file: match.path.text, line: match.line_number ?? 1 }
      }
    }
    return null
  }

  const handleDesignEvent = (e: { payload: string | DesignElementInfo }) => {
    const info = parsePayload(e)
    if (!info) return
    const token = ++picked

    const src = info.source
    if (src?._debug) {
      console.log("[Design] fiber debug:", src._debug.join(" → "))
    }

    setStore("selected", info)
    props.onElementSelect?.(info)

    const comp = info.component ?? src?.component
    const file = src?.file ? normalizePath(src.file) : undefined
    const direct = (hit: Hit) => {
      if (token !== picked) return false
      return openResolved(info, hit)
    }

    // Library/node_modules source — strip it and find user code instead
    if (file && !isSourceFile(file)) {
      console.log("[Design] Source is library/bundled:", file, "for", comp, "— using index/grep to find user code")
      info.source = undefined
      setStore("selected", { ...info })
      locate(info).then((hit) => {
        if (hit) direct(hit)
      })
      return
    }

    // User source file, but it's the call site (e.g. home-client.tsx for <Header />), not the definition
    if (comp && file && isSourceFile(file) && !fileDefinesComponent(file, comp)) {
      console.log("[Design] Source", file, "is call site for", comp, "— checking index then searching")
      locate(info).then((hit) => {
        if (hit) {
          direct(hit)
          return
        }
        console.log("[Design] Definition not found, falling back to call site:", file)
        direct({ file, line: src?.line ?? 1, comp })
      })
      return
    }

    if (file && isSourceFile(file)) {
      console.log("[Design] Opening file:", file, "line:", src?.line, "component:", comp)
      direct({ file, line: src?.line ?? 1, comp })
      return
    }

    locate(info).then((hit) => {
      if (hit) {
        direct(hit)
        return
      }
      console.log("[Design] No valid source for:", info.tag, comp ?? info.classes)
    })
  }

  const snap = () => {
    return {
      selectedElement: store.selected
        ? {
            tagName: store.selected.tag,
            className: store.selected.classes ?? "",
            id: store.selected.id ?? "",
            domPath: store.selected.path,
            sourceFile: store.selected.source?.file,
            sourceLine: store.selected.source?.line,
            computedStyles: store.selected.computedStyles ?? {},
            boundingRect: store.selected.rect,
          }
        : null,
      comments: store.notes,
      viewport: {
        width: preset()?.width ?? 0,
        height: preset()?.height ?? 0,
        preset: store.viewport,
      },
      previewUrl: url(),
    }
  }

  const save = () => {
    if (push) clearTimeout(push)
    push = undefined
    const base = sdk.url
    const state = snap()
    const json = JSON.stringify(state)
    if (json === sent) return
    fetch(`${base}/experimental/design`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state, timestamp: Date.now() }),
    })
      .then(() => {
        sent = json
      })
      .catch(() => {})
  }

  const flush = () => {
    if (push) clearTimeout(push)
    push = setTimeout(save, 200)
  }

  const poll = async () => {
    if (!url()) return
    const base = sdk.url
    const res = await fetch(`${base}/experimental/design`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (!data || !data.timestamp || data.timestamp <= lastCmd) return
    lastCmd = data.timestamp

    if (data.type === "update-styles" && data.styles && webviewOpen) {
      const s = JSON.stringify(data.styles)
      platform.evalDesignWebview?.(`window.__opencode_apply_styles && window.__opencode_apply_styles(${s})`)
    }
    if (data.type === "select" && data.selector && webviewOpen) {
      const sel = JSON.stringify(data.selector)
      platform.evalDesignWebview?.(`window.__opencode_select_element && window.__opencode_select_element(${sel})`)
    }
    if (data.type === "set-viewport" && data.width) {
      const p = data.preset as Viewport | undefined
      if (p === "desktop") {
        setStore("viewport", "desktop")
        setStore("size", undefined)
        return
      }
      const base = p && VIEWPORTS[p] !== undefined ? VIEWPORTS[p] : null
      const next = base && p ? p : "desktop"
      setStore("viewport", next)
      if (!data.height) {
        setStore("size", undefined)
        return
      }
      if (!base || base.width !== data.width || base.height !== data.height) {
        setStore("size", {
          width: data.width,
          height: data.height,
          label: base?.label ?? "Custom",
        })
        return
      }
      setStore("size", undefined)
    }
    if (data.type === "file-changed") {
      queueReindex(typeof data.filePath === "string" ? data.filePath : undefined)
    }
  }

  createEffect(on(() => store.selected, flush, { defer: true }))
  createEffect(on(() => [store.viewport, store.size, url()] as const, flush, { defer: true }))
  createEffect(on(() => store.notes, flush, { defer: true }))

  let unlisten: (() => void) | undefined

  onMount(async () => {
    health = setInterval(check, 5000)
    poller = setInterval(poll, 2000)

    type Listener = (name: string, cb: (e: { payload: string }) => void | Promise<void>) => Promise<() => void>
    const tauri = (globalThis as unknown as { __TAURI__?: { event?: { listen: Listener } } }).__TAURI__
    if (supported() && tauri?.event) {
      const { listen } = tauri.event
      const u1 = await listen("design:element-select", handleDesignEvent)
      const u2 = await listen("design:element-hover", () => {})
      const u3 = await listen("design:debug-source", (e: { payload: string }) => {
        try {
          const data = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
          const lines: string[] = data.log ?? []
          lines.forEach((l) => console.log(l))
        } catch {
          console.log("[Design] debug-source raw:", e.payload)
        }
      })
      const u4 = await listen("design:component-list", async (e: { payload: string }) => {
        try {
          sendWhitelist()
          const data = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
          const names: string[] = data.names ?? []
          if (!names.length) return
          console.log("[Design] Resolving", names.length, "component sources:", names.join(", "))
          const resolved: Record<string, { file: string; line: number }> = {}
          const hits = await Promise.all(
            names.map(async (name) => {
              const hit = (await queryIndex(name, undefined)) ?? (await findDefinition(name))
              if (!hit) return
              return [name, { file: hit.file, line: hit.line }] as const
            }),
          )
          for (const hit of hits) {
            if (!hit) continue
            resolved[hit[0]] = hit[1]
          }
          const count = Object.keys(resolved).length
          if (count > 0) {
            console.log("[Design] Resolved", count, "sources, sending to child webview")
            platform.evalDesignWebview?.(
              `window.__opencode_resolve_sources && window.__opencode_resolve_sources(${JSON.stringify(resolved)})`,
            )
          }
        } catch (err) {
          console.log("[Design] component-list error:", err)
        }
      })
      const u5 = await listen("design:comment-submit", async (e: { payload: string }) => {
        try {
          const data = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
          const text = typeof data?.comment === "string" ? data.comment.trim() : ""
          const raw = data?.info as DesignElementInfo | undefined
          if (!text || !raw) return
          const info =
            store.selected?.path === raw.path
              ? {
                  ...raw,
                  component: store.selected.component ?? raw.component,
                  source: store.selected.source ?? raw.source,
                }
              : raw
          const file = info.source?.file ? normalizePath(info.source.file) : undefined
          const comp = info.component ?? info.source?.component
          const hit =
            !file || !isSourceFile(file) || (comp ? !fileDefinesComponent(file, comp) : false)
              ? await locate(info)
              : null
          const next = hit ? setResolved(info, hit) : info
          setStore("notes", (prev) => [...prev, note(next, text)])

          const path = next.source?.file ? normalizePath(next.source.file) : undefined
          if (!path) return
          props.onComment?.({
            file: path,
            line: next.source?.line ?? 1,
            comment: text,
            component: next.component ?? next.source?.component,
          })
        } catch (err) {
          console.log("[Design] comment-submit error:", err)
        }
      })
      unlisten = () => {
        u1()
        u2()
        u3()
        u4()
        u5()
      }
    }

    if (!url()) detect()
    else {
      check()
      if (url()) openWebview(url())
    }
    buildIndex()
  })

  onCleanup(() => {
    unlisten?.()
    observer?.disconnect()
    if (raf) cancelAnimationFrame(raf)
    if (change) clearTimeout(change)
    if (health) clearInterval(health)
    if (poller) clearInterval(poller)
    if (poke) clearTimeout(poke)
    if (push) save()
    if (reopen) clearTimeout(reopen)
    closeWebview()
  })

  onMount(() => {
    if (!placeholder) return
    observer = new ResizeObserver(syncSize)
    observer.observe(placeholder)
  })

  createEffect(
    on(
      () => sdk.directory,
      () => {
        changed.clear()
        rustNames = []
        resetCache()
        setStore("selected", undefined)
        setStore("notes", [])
        sendWhitelist()
        if (sdk.directory) {
          buildIndex()
        }
        if (url()) return
        detect()
      },
      { defer: true },
    ),
  )

  // Sync inspect mode to child webview
  createEffect(
    on(
      () => store.inspect,
      () => {
        syncInspect()
      },
      { defer: true },
    ),
  )

  // Force resize when viewport preset changes or bottom panels appear/disappear
  createEffect(
    on(
      () => [store.viewport, store.size, store.selected] as const,
      () => {
        syncSize()
      },
      { defer: true },
    ),
  )

  // Clear selected overlay in child webview when selection is cleared
  createEffect(
    on(
      () => store.selected,
      (sel) => {
        if (!webviewOpen || sel) return
        platform.evalDesignWebview?.(`window.__opencode_clear_selection && window.__opencode_clear_selection()`)
      },
      { defer: true },
    ),
  )

  const dot = createMemo(() => {
    if (store.status === "connected") return "bg-green-500"
    if (store.status === "loading") return "bg-yellow-500"
    return "bg-gray-400"
  })

  if (!supported()) {
    return (
      <div class="flex flex-col h-full bg-background-base items-center justify-center">
        <div class="text-14-regular text-text-weak max-w-64 text-center">
          Design preview is only available in the desktop app.
        </div>
      </div>
    )
  }

  return (
    <div class="flex flex-col h-full bg-background-base border-x border-b border-border-weak-base">
      {/* Toolbar */}
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border-weak-base bg-background-stronger shrink-0">
        <div class={`size-2 rounded-full shrink-0 ${dot()}`} />

        <form class="flex-1 min-w-0 flex items-center gap-1.5" onSubmit={submit}>
          <input
            type="text"
            class="flex-1 min-w-0 h-6 px-2 text-12-regular bg-surface-panel border border-border-weak-base rounded-md text-text-strong placeholder:text-text-weaker outline-none focus:border-border-strong"
            placeholder="http://localhost:3000"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
          />
          <Tooltip value="Load URL" placement="top">
            <IconButton type="submit" icon="enter" variant="ghost" class="size-6 shrink-0" aria-label="Load URL" />
          </Tooltip>
        </form>

        <Tooltip value="Refresh" placement="top">
          <IconButton icon="reset" variant="ghost" class="size-6 shrink-0" onClick={refresh} aria-label="Refresh" />
        </Tooltip>

        <Show when={url()}>
          <Tooltip value="Disconnect" placement="top">
            <IconButton
              icon="close-small"
              variant="ghost"
              class="size-6 shrink-0"
              onClick={disconnect}
              aria-label="Disconnect"
            />
          </Tooltip>
        </Show>

        <Show when={store.framework}>
          {(fw) => <span class="text-11-regular text-text-weak px-1 shrink-0">{fw()}</span>}
        </Show>

        <div class="flex items-center border border-border-weak-base rounded-md overflow-hidden shrink-0">
          <Tooltip value="Desktop" placement="top">
            <button
              class="h-6 px-1.5 flex items-center justify-center text-icon-base hover:bg-surface-raised-base hover:text-icon-strong"
              classList={{
                "bg-surface-raised-base-active text-icon-strong": store.viewport === "desktop",
              }}
              onClick={() => {
                setStore("viewport", "desktop")
                setStore("size", undefined)
              }}
              aria-label="Desktop viewport"
            >
              <Icon name="square-arrow-top-right" size="small" />
            </button>
          </Tooltip>
          <Tooltip value="Tablet (768×1024)" placement="top">
            <button
              class="h-6 px-1.5 flex items-center justify-center border-l border-border-weak-base text-icon-base hover:bg-surface-raised-base hover:text-icon-strong"
              classList={{
                "bg-surface-raised-base-active text-icon-strong": store.viewport === "tablet",
              }}
              onClick={() => {
                setStore("viewport", "tablet")
                setStore("size", undefined)
              }}
              aria-label="Tablet viewport"
            >
              <Icon name="sidebar" size="small" />
            </button>
          </Tooltip>
          <Tooltip value="Mobile (375×812)" placement="top">
            <button
              class="h-6 px-1.5 flex items-center justify-center border-l border-border-weak-base text-icon-base hover:bg-surface-raised-base hover:text-icon-strong"
              classList={{
                "bg-surface-raised-base-active text-icon-strong": store.viewport === "mobile",
              }}
              onClick={() => {
                setStore("viewport", "mobile")
                setStore("size", undefined)
              }}
              aria-label="Mobile viewport"
            >
              <Icon name="task" size="small" />
            </button>
          </Tooltip>
        </div>

        <Tooltip value={store.inspect ? "Disable inspection" : "Inspect elements"} placement="top">
          <Button
            variant="ghost"
            class="h-6 px-1.5 shrink-0"
            classList={{
              "bg-surface-raised-base-active text-text-strong": store.inspect,
            }}
            onClick={() => setStore("inspect", !store.inspect)}
            aria-label="Toggle element inspection"
          >
            <Icon name="eye" size="small" />
          </Button>
        </Tooltip>
      </div>

      {/* Preview area — native webview is positioned on top of this placeholder */}
      <div
        ref={container}
        class="flex-1 min-h-0 flex items-center justify-center bg-background-base overflow-hidden relative px-3 pb-3 pt-2"
      >
        <Show
          when={url()}
          fallback={
            <div class="flex flex-col items-center gap-4 text-center p-8">
              <div class="text-14-regular text-text-weak max-w-64">
                {store.detecting ? "Detecting dev server..." : "No dev server detected"}
              </div>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="small" onClick={detect} disabled={store.detecting}>
                  {store.detecting ? "Detecting..." : "Auto-detect"}
                </Button>
              </div>
            </div>
          }
        >
          <Show when={active() && preset()}>
            {(p) => (
              <div class="absolute top-2 text-11-regular text-text-weaker">
                {p().label} — {p().width}×{p().height}
              </div>
            )}
          </Show>
          <div
            class="border border-border-weak-base bg-background-base rounded-xl overflow-hidden"
            classList={{
              "size-full mt-2": !active(),
              "mt-4": active(),
            }}
            style={
              active() && preset()
                ? {
                    width: `${preset()!.width}px`,
                    height: `${preset()!.height}px`,
                    "max-height": "calc(100% - 32px)",
                  }
                : undefined
            }
          >
            <div ref={placeholder} class="size-full bg-transparent" />
          </div>
        </Show>
      </div>

      {/* Selected element info bar — outside the preview container so it's not behind the native webview */}
      <Show when={store.selected}>
        {(el) => (
          <div class="shrink-0 border-t border-border-weak-base bg-background-stronger">
            {/* Component ancestry breadcrumb */}
            <Show when={el().ancestry && el().ancestry!.length > 0}>
              <div class="px-3 py-1 flex items-center gap-1 text-11-regular border-b border-border-weak-base overflow-x-auto scrollbar-none">
                <span class="text-text-weaker shrink-0">Tree:</span>
                <For each={[...(el().ancestry ?? [])].reverse()}>
                  {(name, idx) => (
                    <>
                      <Show when={idx() > 0}>
                        <span class="text-text-weaker">›</span>
                      </Show>
                      <button
                        class="font-mono hover:text-text-strong shrink-0 px-0.5 rounded cursor-pointer"
                        classList={{
                          "text-purple-400 font-medium": name === el().component,
                          "text-text-weak hover:underline": name !== el().component,
                        }}
                        onClick={() => void openComp(name)}
                        title={`Navigate to ${name}`}
                      >
                        {name}
                      </button>
                    </>
                  )}
                </For>
              </div>
            </Show>
            {/* Element details */}
            <div class="px-3 py-1.5 flex items-center gap-2 text-12-regular">
              <Show when={el().component}>
                <span class="text-purple-400 font-mono shrink-0">
                  {"<"}
                  {el().component}
                  {">"}
                </span>
              </Show>
              <span class="text-text-strong font-mono truncate">
                {"<"}
                {el().tag}
                {el().id ? `#${el().id}` : ""}
                {(() => {
                  const c = el().classes
                  if (!c) return ""
                  const parts = c.split(" ")
                  return ` class="${parts.slice(0, 3).join(" ")}${parts.length > 3 ? "…" : ""}"`
                })()}
                {">"}
              </span>
              <Show when={el().source?.file}>
                {(file) => {
                  const src = el().source!
                  const comp = el().component ?? src.component
                  const norm = normalizePath(file())
                  const isDef = !comp || fileDefinesComponent(norm, comp)
                  return (
                    <button
                      class="text-text-weak hover:text-text-strong underline shrink-0"
                      title={isDef ? norm : `Call site: ${norm} — click to find ${comp} definition`}
                      onClick={() => {
                        if (comp && !isDef) {
                          openComp(comp).then((found) => {
                            if (!found) props.onOpenFile?.(norm, src.line ?? 1)
                          })
                        } else {
                          props.onOpenFile?.(norm, src.line ?? 1)
                        }
                      }}
                    >
                      {isDef ? file().split("/").pop() : comp}
                      {isDef ? `:${src.line ?? 1}` : ""}
                    </button>
                  )
                }}
              </Show>
              <Show when={el().textContent}>
                <span class="text-text-weaker text-11-regular truncate max-w-32" title={el().textContent}>
                  "{el().textContent}"
                </span>
              </Show>
              <Show when={!el().source?.file && !el().textContent && el().searchHint?.length}>
                <span class="text-text-weaker text-11-regular truncate">
                  search: {el().searchHint!.slice(0, 2).join(", ")}
                </span>
              </Show>
              <div class="ml-auto flex items-center gap-1 shrink-0">
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  class="size-5"
                  aria-label="Clear selection"
                  onClick={() => {
                    setStore("selected", undefined)
                    props.onElementSelect?.(undefined)
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
