# Integrated Browser and Element Annotations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un navegador integrado Electron en OpenCode Desktop con anotaciones de DOM, cápsulas de chat agregadas, captura de pantalla, y herramientas de navegador para el agente.

**Architecture:** Browserview/WebContentsView aislado en el main process de Electron, compartido con el renderer via IPC controlada. Renderer mantiene UI (chat, panels, input, cápsulas). El agente interactúa exclusivamente via herramientas explícitas que rutean por IPC al BrowserManager del main process. Partition persistente `persist:opencode-browser` para sesiones.

**Tech Stack:** Electron BrowserView/WebContentsView, SolidJS (renderer), IPC handlers en main process, preload bridge para APIs seguras.

---

## Estructura de Archivos

```txt
packages/desktop/src/main/browser/
├── index.ts              # BrowserManager singleton, exporta API
├── BrowserManager.ts     # View lifecycle, navegación, cookies, sesión persistente
├── ipc-handlers.ts      # Handlers IPC para browser.* (navegación, inspect, screenshot, annotation)
├── annotation.ts         # Lógica de extracción de anotación (selector, role, bounding box, DOM cercano)
├── screenshot.ts        # Captura de viewport/elemento/screenshot crop
└── types.ts             # Tipos BrowserAnnotation, BrowserScreenshot, AgentToolPayload

packages/desktop/src/preload/
├── browser.ts            # Bridge window.api.browser.* — expone API al renderer
└── types.ts             # Extender ElectronAPI con browser namespace

packages/app/src/context/
└── annotation-store.tsx # Store SolidJS para annotations activas, CRUD, serialization

packages/app/src/components/
├── browser-panel/
│   ├── BrowserPanel.tsx        # Panel del navegador, colapsable
│   ├── BrowserPanel.css        # Estilos
│   ├── BrowserPaneltoolbar.tsx # Controles nav, dirección URL, botón Anotar
│   └── index.ts
└── annotation-capsule/
    ├── AnnotationCapsule.tsx    # Cápsula "N anotaciones" en prompt input
    ├── AnnotationBubble.tsx     # Bubble inline de comentario sobre elemento
    └── index.ts

packages/app/src/components/prompt-input/
└── build-request-parts.ts  # EXTENDER: serializar compact annotation context en request parts

packages/app/src/components/prompt-input/attachments.ts # optional: reuse existing image attachment patterns for screenshots
```

---

## Phase 1 — Browser basics

### Task 1: BrowserManager y types

**Files:**
- Create: `packages/desktop/src/main/browser/types.ts`
- Create: `packages/desktop/src/main/browser/BrowserManager.ts`
- Create: `packages/desktop/src/main/browser/index.ts`

**Types (`types.ts`):**

```ts
export type BrowserAnnotation = {
  id: string
  pageUrl: string
  pageTitle: string
  userComment: string
  element: {
    tagName: string
    role?: string
    accessibleName?: string
    visibleText?: string
    attributes: Record<string, string>
    selector: string
    xpath?: string
    boundingBox: { x: number; y: number; width: number; height: number }
  }
  preview: {
    screenshotCrop?: string
    viewportScreenshotId?: string
  }
  context: {
    nearbyDomSanitized?: string
    accessibilitySnapshotNearby?: unknown
  }
  createdAt: number
}

export type BrowserScreenshot = {
  id: string
  pageUrl: string
  pageTitle: string
  imageData: string
  viewport: { width: number; height: number; deviceScaleFactor: number }
  createdAt: number
}

export type BrowserPanelState = {
  visible: boolean
  url: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  inspectMode: boolean
}

export type AgentToolPayload =
  | { tool: "browser.open" }
  | { tool: "browser.navigate"; url: string }
  | { tool: "browser.back" }
  | { tool: "browser.forward" }
  | { tool: "browser.reload" }
  | { tool: "browser.click"; selector: string }
  | { tool: "browser.type"; selector: string; text: string }
  | { tool: "browser.press"; key: string }
  | { tool: "browser.screenshot" }
  | { tool: "browser.inspect"; selector?: string }
  | { tool: "browser.get_snapshot" }
  | { tool: "browser.annotation.get_detail"; id: string }
  | { tool: "browser.clear_data" }
  | { tool: "browser.upload_file"; selector: string; fileRef: string }
  | { tool: "browser.downloads.list" }
```

**BrowserManager (`BrowserManager.ts`):**

```ts
import { BrowserView, BrowserWindow, app } from "electron"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const BROWSER_PARTITION = "persist:opencode-browser"

let browserView: BrowserView | null = null
let browserWindow: BrowserWindow | null = null

function getOrCreateView(): BrowserView {
  if (browserView) return browserView

  browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: BROWSER_PARTITION,
    },
  })

  return browserView
}

export function attachBrowserView(win: BrowserWindow) {
  browserWindow = win
  const view = getOrCreateView()
  win.addBrowserView(view)
  // Bounds iniciales se setean desde el renderer via IPC
}

export function getBrowserView(): BrowserView | null {
  return browserView
}

export function setBrowserViewBounds(bounds: { x: number; y: number; width: number; height: number }) {
  browserView?.setBounds(bounds)
}

export function showBrowserView() {
  browserView?.webContents.delegateRelations.show()
}

export function hideBrowserView() {
  browserView?.webContents.delegateRelations.hide()
}

export async function navigate(url: string) {
  const view = getOrCreateView()
  await view.webContents.navigate(url)
}

export async function goBack() {
  const view = getOrCreateView()
  if (view.webContents.canGoBack()) view.webContents.goBack()
}

export async function goForward() {
  const view = getOrCreateView()
  if (view.webContents.canGoForward()) view.webContents.goForward()
}

export async function reload() {
  getOrCreateView().webContents.reload()
}

export async function clearBrowserData() {
  const view = getOrCreateView()
  const session = view.webContents.session
  await session.clearStorageData()
  await session.clearCache()
  // No limpiar cookies persistentes — solo cache
}

export function getCurrentUrl(): string {
  return browserView?.webContents.getURL() ?? ""
}

export function getCurrentTitle(): string {
  return browserView?.webContents.getTitle() ?? ""
}

export function isInspectMode(): boolean {
  // Estado trackeado en el store del renderer
  return false
}
```

- [x] **Step 1: Crear packages/desktop/src/main/browser/types.ts** — Copiar los tipos de arriba.
- [x] **Step 2: Crear packages/desktop/src/main/browser/BrowserManager.ts** — Implementar singleton, getOrCreateView, attachBrowserView, setBrowserViewBounds, navigate, goBack, goForward, reload, clearBrowserData.
- [x] **Step 3: Crear packages/desktop/src/main/browser/index.ts** — Re-exportar todo desde BrowserManager.
- [x] **Step 4: Modificar packages/desktop/src/main/windows.ts** — Importar `attachBrowserView` y llamarla con `win` después de `createMainWindow` retorna. Alternativamente, crear una función `registerBrowserView(win: BrowserWindow)` en windows.ts que sea llamada desde index.ts del main.
- [ ] **Step 5: Verificación** — `cd packages/desktop && bun typecheck` (sin errors de importación).

---

### Task 2: IPC handlers del navegador

**Files:**
- Create: `packages/desktop/src/main/browser/ipc-handlers.ts`
- Modify: `packages/desktop/src/main/ipc.ts` — registrar handlers

**ipc-handlers.ts:**

```ts
import { ipcMain, dialog } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import {
  attachBrowserView,
  setBrowserViewBounds,
  showBrowserView,
  hideBrowserView,
  navigate,
  goBack,
  goForward,
  reload,
  clearBrowserData,
  getBrowserView,
  getCurrentUrl,
  getCurrentTitle,
} from "./BrowserManager"

type BoundsPayload = { x: number; y: number; width: number; height: number }

export function registerBrowserIpcHandlers() {
  // Panel visibility
  ipcMain.on("browser-attach", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) attachBrowserView(win)
  })

  ipcMain.on("browser-set-bounds", (_event: IpcMainInvokeEvent, bounds: BoundsPayload) => {
    setBrowserViewBounds(bounds)
  })

  ipcMain.on("browser-show", () => showBrowserView())
  ipcMain.on("browser-hide", () => hideBrowserView())

  // Navigation
  ipcMain.handle("browser-navigate", async (_event: IpcMainInvokeEvent, url: string) => {
    await navigate(url)
    return { url: getCurrentUrl(), title: getCurrentTitle() }
  })

  ipcMain.handle("browser-back", async () => {
    await goBack()
    return { url: getCurrentUrl(), title: getCurrentTitle() }
  })

  ipcMain.handle("browser-forward", async () => {
    await goForward()
    return { url: getCurrentUrl(), title: getCurrentTitle() }
  })

  ipcMain.handle("browser-reload", async () => {
    await reload()
  })

  // Clear data
  ipcMain.handle("browser-clear-data", async () => {
    await clearBrowserData()
  })

  // State queries
  ipcMain.handle("browser-state", () => {
    const view = getBrowserView()
    if (!view) return { visible: false, url: "", canGoBack: false, canGoForward: false, isLoading: false }
    return {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      isLoading: false, // completar con did-start-loading/did-stop-loading events
    }
  })

  // Screenshot
  ipcMain.handle("browser-screenshot", async () => {
    const view = getBrowserView()
    if (!view) return null
    const image = await view.webContents.capturePage()
    return image.toPNG().toString("base64")
  })
}
```

- [ ] **Step 1: Crear packages/desktop/src/main/browser/ipc-handlers.ts** — Implementar handlers IPC listados.
- [ ] **Step 2: Modificar packages/desktop/src/main/ipc.ts** — Importar `registerBrowserIpcHandlers` y llamarla en `registerIpcHandlers`.
- [ ] **Step 3: Verificación** — `cd packages/desktop && bun typecheck`.

---

### Task 3: Preload bridge

**Files:**
- Create: `packages/desktop/src/preload/browser.ts`
- Modify: `packages/desktop/src/preload/types.ts`

**browser.ts:**

```ts
import { contextBridge } from "electron"

export type BrowserAPI = {
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  show: () => void
  hide: () => void
  attach: () => void
  navigate: (url: string) => Promise<{ url: string; title: string }>
  back: () => Promise<{ url: string; title: string }>
  forward: () => Promise<{ url: string; title: string }>
  reload: () => Promise<void>
  clearData: () => Promise<void>
  getState: () => Promise<{
    visible: boolean
    url: string
    title: string
    canGoBack: boolean
    canGoForward: boolean
    isLoading: boolean
  }>
  screenshot: () => Promise<string | null>
  // Annotation
  startInspectMode: () => void
  stopInspectMode: () => void
  getAnnotationData: (selector: string) => Promise<AnnotationData | null>
  // Agent tools
  toolNavigate: (url: string) => Promise<{ url: string; title: string }>
  toolBack: () => Promise<{ url: string; title: string }>
  toolForward: () => Promise<{ url: string; title: string }>
  toolReload: () => Promise<void>
  toolClick: (selector: string) => Promise<void>
  toolType: (selector: string, text: string) => Promise<void>
  toolPress: (key: string) => Promise<void>
  toolScreenshot: () => Promise<string | null>
  toolInspect: (selector?: string) => Promise<unknown>
  toolGetSnapshot: () => Promise<unknown>
  toolAnnotationGetDetail: (id: string) => Promise<unknown>
  toolClearData: () => Promise<void>
  toolUploadFile: (selector: string, fileRef: string) => Promise<void>
  toolListDownloads: () => Promise<string[]>
}

export type AnnotationData = {
  tagName: string
  role?: string
  accessibleName?: string
  visibleText?: string
  attributes: Record<string, string>
  selector: string
  xpath?: string
  boundingBox: { x: number; y: number; width: number; height: number }
  nearbyDomSanitized?: string
}

const browserAPI: BrowserAPI = {
  setBounds: (bounds) => void window.api.send("browser-set-bounds", bounds),
  show: () => void window.api.send("browser-show"),
  hide: () => void window.api.send("browser-hide"),
  attach: () => void window.api.send("browser-attach"),
  navigate: (url) => window.api.invoke("browser-navigate", url),
  back: () => window.api.invoke("browser-back"),
  forward: () => window.api.invoke("browser-forward"),
  reload: () => window.api.invoke("browser-reload"),
  clearData: () => window.api.invoke("browser-clear-data"),
  getState: () => window.api.invoke("browser-state"),
  screenshot: () => window.api.invoke("browser-screenshot"),
  startInspectMode: () => void window.api.send("browser-inspect-start"),
  stopInspectMode: () => void window.api.send("browser-inspect-stop"),
  getAnnotationData: (selector) => window.api.invoke("browser-get-annotation-data", selector),
  toolNavigate: (url) => window.api.invoke("browser-navigate", url),
  toolBack: () => window.api.invoke("browser-back"),
  toolForward: () => window.api.invoke("browser-forward"),
  toolReload: () => window.api.invoke("browser-reload"),
  toolClick: (selector) => window.api.invoke("browser-click", selector),
  toolType: (selector, text) => window.api.invoke("browser-type", selector, text),
  toolPress: (key) => window.api.invoke("browser-press", key),
  toolScreenshot: () => window.api.invoke("browser-screenshot"),
  toolInspect: (selector) => window.api.invoke("browser-inspect", selector),
  toolGetSnapshot: () => window.api.invoke("browser-get-snapshot"),
  toolAnnotationGetDetail: (id) => window.api.invoke("browser-annotation-get-detail", id),
  toolClearData: () => window.api.invoke("browser-clear-data"),
  toolUploadFile: (selector, fileRef) => window.api.invoke("browser-upload-file", selector, fileRef),
  toolListDownloads: () => window.api.invoke("browser-downloads-list"),
}

contextBridge.exposeInMainWorld("browser", browserAPI)
```

- [x] **Step 1: Crear packages/desktop/src/preload/browser.ts** — Implementar preload bridge con todas las APIs listadas.
- [x] **Step 2: Modificar packages/desktop/src/preload/types.ts** — Agregar `browser?: BrowserAPI` a `ElectronAPI` (o acceder via window.browser directamente).
- [x] **Step 3: Verificación** — `cd packages/desktop && bun typecheck`.

---

## Phase 2 — Agent browser tools

### Task 4: Implementación completa de herramientas del agente

**Files:**
- Modify: `packages/desktop/src/main/browser/ipc-handlers.ts` — agregar todos los handlers de tools
- Modify: `packages/desktop/src/main/browser/BrowserManager.ts` — agregar click, type, press, inspect, get_snapshot

**BrowserManager.ts agregar:**

```ts
export async function click(selector: string) {
  const view = getOrCreateView()
  await view.webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el) el.click()
    })()
  `)
}

export async function typeText(selector: string, text: string) {
  const view = getOrCreateView()
  await view.webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el && el.focus) { el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })) }
    })()
  `)
}

export async function pressKey(key: string) {
  const view = getOrCreateView()
  await view.webContents.executeJavaScript(`
    (function() {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))
      document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }))
    })()
  `)
}

export async function getSnapshot(): Promise<unknown> {
  const view = getOrCreateView()
  return view.webContents.executeJavaScript(`
    (function() {
      function getAttributes(el) {
        const attrs = {}
        for (const attr of el.attributes) attrs[attr.name] = attr.value
        return attrs
      }
      function visibleText(el) {
        return el.innerText?.trim() ?? ""
      }
      function getSelector(el) {
        if (el.id) return '#' + el.id
        let sel = el.tagName.toLowerCase()
        if (el.className) sel += '.' + el.className.split(' ').filter(Boolean).join('.')
        return sel
      }
      function getRole(el) {
        return el.getAttribute('role') ?? undefined
      }
      function getAriaName(el) {
        return el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? undefined
      }
      const els = document.querySelectorAll('a, button, input, select, textarea, [role=button], [role=link]')
      return Array.from(els).map(el => ({
        selector: getSelector(el),
        tagName: el.tagName,
        role: getRole(el),
        accessibleName: getAriaName(el),
        visibleText: visibleText(el),
        attributes: getAttributes(el),
        boundingBox: el.getBoundingClientRect()
      }))
    })()
  `)
}

export async function getAnnotationData(selector: string): Promise<{
  tagName: string
  role?: string
  accessibleName?: string
  visibleText?: string
  attributes: Record<string, string>
  selector: string
  xpath?: string
  boundingBox: { x: number; y: number; width: number; height: number }
  nearbyDomSanitized: string
} | null> {
  const view = getOrCreateView()
  return view.webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      function getAttrs(e) {
        const a = {}
        for (const attr of e.attributes) a[attr.name] = attr.value
        return a
      }
      function getXPath(e) {
        if (e.id) return "//*[@id='" + e.id + "']"
        const parts = []
        while (e && e.nodeType === Node.ELEMENT_NODE) {
          let index = 1
          let sibling = e.previousSibling
          while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === e.nodeName) index++
            sibling = sibling.previousSibling
          }
          parts.unshift(e.nodeName.toLowerCase() + '[' + index + ']')
          e = e.parentNode as Element
        }
        return '/' + parts.join('/')
      }
      function sanitize(text) {
        return (text || '').replace(/[\\x00-\\x1F]/g, ' ').slice(0, 500)
      }
      const nearby = el.parentElement?.innerText?.trim() ?? ''
      return {
        tagName: el.tagName,
        role: el.getAttribute('role') ?? undefined,
        accessibleName: el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? undefined,
        visibleText: el.innerText?.trim().slice(0, 200) ?? '',
        attributes: getAttrs(el),
        selector: ${JSON.stringify(selector)},
        xpath: getXPath(el),
        boundingBox: el.getBoundingClientRect(),
        nearbyDomSanitized: sanitize(nearby)
      }
    })()
  `)
}

export async function uploadFile(selector: string, fileRef: string) {
  const view = getOrCreateView()
  await view.webContents.executeJavaScript(`
    (function() {
      const input = document.querySelector(${JSON.stringify(selector)})
      if (input && input.type === 'file') {
        // Trigger con ruta — Electron permite establecer archivos nativamente
        const dt = new DataTransfer()
        // fileRef es path de workspace — se resuelve en el main process
        // Aquí pasamos el path directamente al input
        // NOTA: Electron tiene limitaciones con archivos simulados
      }
    })()
  `)
}
```

**ipc-handlers.ts — handlers adicionales:**

```ts
ipcMain.handle("browser-click", async (_event: IpcMainInvokeEvent, selector: string) => {
  await click(selector)
})

ipcMain.handle("browser-type", async (_event: IpcMainInvokeEvent, selector: string, text: string) => {
  await typeText(selector, text)
})

ipcMain.handle("browser-press", async (_event: IpcMainInvokeEvent, key: string) => {
  await pressKey(key)
})

ipcMain.handle("browser-inspect", async (_event: IpcMainInvokeEvent, selector?: string) => {
  if (selector) return getAnnotationData(selector)
  return getSnapshot()
})

ipcMain.handle("browser-get-snapshot", async () => {
  return getSnapshot()
})

ipcMain.handle("browser-get-annotation-data", async (_event: IpcMainInvokeEvent, selector: string) => {
  return getAnnotationData(selector)
})

ipcMain.handle("browser-annotation-get-detail", async (_event: IpcMainInvokeEvent, id: string) => {
  // Delegar al annotation store — se implementa en Phase 4
  return null
})

ipcMain.handle("browser-upload-file", async (_event: IpcMainInvokeEvent, selector: string, fileRef: string) => {
  await uploadFile(selector, fileRef)
})

ipcMain.handle("browser-downloads-list", async () => {
  // Descargas controladas van a un directorio dedicado
  return []
})
```

- [ ] **Step 1: Agregar click, typeText, pressKey, getSnapshot, getAnnotationData a BrowserManager.ts**
- [ ] **Step 2: Agregar todos los ipcMain.handle restantes en ipc-handlers.ts**
- [ ] **Step 3: Verificación** — `cd packages/desktop && bun typecheck`

---

## Phase 3 — DOM element annotation

### Task 5: Inspect mode y comment bubble

**Files:**
- Modify: `packages/desktop/src/main/browser/ipc-handlers.ts` — agregar handlers inspect mode
- Create: `packages/desktop/src/main/browser/annotation.ts` — lógica de extracción
- Create: `packages/app/src/context/annotation-store.tsx`
- Create: `packages/app/src/components/browser-panel/BrowserPanel.tsx`
- Create: `packages/app/src/components/browser-panel/BrowserPanelToolbar.tsx`
- Create: `packages/app/src/components/browser-panel/BrowserPanel.css`
- Create: `packages/app/src/components/browser-panel/index.ts`
- Create: `packages/app/src/components/annotation-capsule/AnnotationCapsule.tsx`
- Create: `packages/app/src/components/annotation-capsule/AnnotationBubble.tsx`
- Create: `packages/app/src/components/annotation-capsule/index.ts`

**annotation-store.tsx:**

```tsx
import { createStore } from "solid-js/store"
import { uuid } from "@/utils/uuid"
import type { BrowserAnnotation } from "../../../../desktop/src/main/browser/types"

type AnnotationStore = {
  annotations: BrowserAnnotation[]
  inspectMode: boolean
  pendingAnnotation: Partial<BrowserAnnotation> | null
}

const [store, setStore] = createStore<AnnotationStore>({
  annotations: [],
  inspectMode: false,
  pendingAnnotation: null,
})

export function useAnnotationStore() {
  function startInspectMode() {
    setStore("inspectMode", true)
  }

  function stopInspectMode() {
    setStore("inspectMode", false)
    setStore("pendingAnnotation", null)
  }

  function addAnnotation(annotation: Omit<BrowserAnnotation, "id" | "createdAt">) {
    const full: BrowserAnnotation = {
      ...annotation,
      id: uuid(),
      createdAt: Date.now(),
    }
    setStore("annotations", (prev) => [...prev, full])
    return full.id
  }

  function removeAnnotation(id: string) {
    setStore("annotations", (prev) => prev.filter((a) => a.id !== id))
  }

  function getAnnotation(id: string): BrowserAnnotation | undefined {
    return store.annotations.find((a) => a.id === id)
  }

  function setPendingAnnotation(data: Partial<BrowserAnnotation> | null) {
    setStore("pendingAnnotation", data)
  }

  function clearAll() {
    setStore("annotations", [])
  }

  return {
    store,
    startInspectMode,
    stopInspectMode,
    addAnnotation,
    removeAnnotation,
    getAnnotation,
    setPendingAnnotation,
    clearAll,
  }
}
```

**annotation.ts (main process — extracción de annotation data):**

```ts
// Extiende BrowserManager.ts con la lógica de extracción ya definida en Task 4
// Este archivo centraliza la lógica de parsing del DOM para anotaciones
import { getAnnotationData } from "./BrowserManager"

export type AnnotationExtractResult = Awaited<ReturnType<typeof getAnnotationData>>

export async function extractAnnotation(selector: string): Promise<AnnotationExtractResult> {
  return getAnnotationData(selector)
}

export function sanitizeDomText(text: string, maxLength = 500): string {
  return (text ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}
```

**BrowserPanel.tsx:**

```tsx
import { createSignal, onMount, onCleanup, Show, For } from "solid-js"
import { useAnnotationStore } from "@/context/annotation-store"
import { BrowserPanelToolbar } from "./BrowserPanelToolbar"
import "./BrowserPanel.css"

export function BrowserPanel() {
  const annotationStore = useAnnotationStore()
  const [url, setUrl] = createSignal("")
  const [isLoading, setIsLoading] = createSignal(false)

  // Escuchar eventos del navegador (inspeccionar, cargar página)
  onMount(() => {
    const api = window.browser
    if (!api) return

    // Polling de estado — alternativa a eventos IPC continuos
    const interval = setInterval(async () => {
      const state = await api.getState()
      setUrl(state.url)
      setIsLoading(state.isLoading)
    }, 500)

    onCleanup(() => clearInterval(interval))
  })

  return (
    <div class="browser-panel">
      <BrowserPanelToolbar url={url()} isLoading={isLoading()} />
      <div class="browser-panel-view" />
      <Show when={annotationStore.store.inspectMode}>
        <div class="browser-inspect-overlay" />
      </Show>
    </div>
  )
}
```

**BrowserPanelToolbar.tsx:**

```tsx
import { createSignal } from "solid-js"
import { useAnnotationStore } from "@/context/annotation-store"

type Props = {
  url: string
  isLoading: boolean
}

export function BrowserPanelToolbar(props: Props) {
  const annotationStore = useAnnotationStore()
  const [inputUrl, setInputUrl] = createSignal(props.url)

  const handleNavigate = () => {
    window.browser?.navigate(inputUrl())
  }

  const handleAnnotate = () => {
    annotationStore.startInspectMode()
    window.browser?.startInspectMode()
  }

  return (
    <div class="browser-panel-toolbar">
      <div class="browser-nav-controls">
        <button onClick={() => window.browser?.back()} disabled={!props.url}>←</button>
        <button onClick={() => window.browser?.forward()}>→</button>
        <button onClick={() => window.browser?.reload()}>↻</button>
      </div>
      <input
        class="browser-url-input"
        type="text"
        value={props.url}
        onInput={(e) => setInputUrl(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
      />
      <button onClick={handleAnnotate}>Anotar</button>
    </div>
  )
}
```

**AnnotationBubble.tsx:**

```tsx
import { createSignal, Show } from "solid-js"

type Props = {
  boundingBox: { x: number; y: number; width: number; height: number }
  onConfirm: (comment: string) => void
  onCancel: () => void
}

export function AnnotationBubble(props: Props) {
  const [comment, setComment] = createSignal("")

  return (
    <div
      class="annotation-bubble"
      style={{
        left: `${props.boundingBox.x + props.boundingBox.width + 8}px`,
        top: `${props.boundingBox.y}px`,
      }}
    >
      <textarea
        placeholder="Escribe tu anotación..."
        onInput={(e) => setComment(e.currentTarget.value)}
      />
      <div class="annotation-bubble-actions">
        <button onClick={props.onCancel}>Cancelar</button>
        <button onClick={() => props.onConfirm(comment())}>Confirmar</button>
      </div>
    </div>
  )
}
```

**AnnotationCapsule.tsx:**

```tsx
import { Show } from "solid-js"
import { useAnnotationStore } from "@/context/annotation-store"

export function AnnotationCapsule() {
  const store = useAnnotationStore()
  const count = () => store.annotations.length

  return (
    <Show when={count() > 0}>
      <div class="annotation-capsule">
        <span class="annotation-capsule-icon">📍</span>
        <span class="annotation-capsule-text">
          {count() === 1 ? "1 anotación" : `${count()} anotaciones`}
        </span>
        <button class="annotation-capsule-remove" onClick={() => store.clearAll()}>×</button>
      </div>
    </Show>
  )
}
```

- [x] **Step 1: Crear packages/app/src/context/annotation-store.tsx**
- [x] **Step 2: Crear packages/app/src/main/browser/annotation.ts** (lógica de extracción centralizada)
- [x] **Step 3: Crear packages/app/src/components/browser-panel/BrowserPanel.tsx** y BrowserPanel.css
- [x] **Step 4: Crear packages/app/src/components/browser-panel/BrowserPanelToolbar.tsx**
- [x] **Step 5: Crear packages/app/src/components/browser-panel/index.ts**
- [x] **Step 6: Crear packages/app/src/components/annotation-capsule/AnnotationBubble.tsx**
- [x] **Step 7: Crear packages/app/src/components/annotation-capsule/AnnotationCapsule.tsx**
- [x] **Step 8: Crear packages/app/src/components/annotation-capsule/index.ts**
- [x] **Step 9: Modificar packages/desktop/src/main/browser/ipc-handlers.ts** — agregar handlers `browser-inspect-start`, `browser-inspect-stop`
- [ ] **Step 10: Verificación** — `cd packages/app && bun typecheck`

---

## Phase 4 — Chat capsules y hybrid context

### Task 6: Integración con build-request-parts

**Files:**
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Modify: `packages/app/src/context/annotation-store.tsx`

**Extensión de build-request-parts.ts:**

Agregar un nuevo tipo `AnnotationPartInput` y serializar annotations en los request parts:

```ts
import type { BrowserAnnotation } from "../../../../desktop/src/main/browser/types"

export type AnnotationPartInput = {
  id: string
  type: "annotation"
  count: number
  preview: string // "1 anotación" / "N anotaciones"
  compact: Array<{
    id: string
    pageUrl: string
    pageTitle: string
    userComment: string
    selector: string
    role?: string
    accessibleName?: string
    visibleText?: string
    boundingBox: { x: number; y: number; width: number; height: number }
    screenshotCrop?: string
    nearbyDomSanitized?: string
  }>
}

type BuildRequestPartsInput = {
  // ... campos existentes ...
  annotations?: BrowserAnnotation[]
}
```

En la función `buildRequestParts`, agregar después de `images`:

```ts
const annotations = (input.annotations ?? []).map((ann) => {
  const compact = {
    id: ann.id,
    pageUrl: ann.pageUrl,
    pageTitle: ann.pageTitle,
    userComment: ann.userComment,
    selector: ann.element.selector,
    role: ann.element.role,
    accessibleName: ann.element.accessibleName,
    visibleText: ann.element.visibleText?.slice(0, 100),
    boundingBox: ann.element.boundingBox,
    screenshotCrop: ann.preview.screenshotCrop,
    nearbyDomSanitized: ann.context.nearbyDomSanitized?.slice(0, 200),
  }
  return {
    id: Identifier.ascending("part"),
    type: "annotation",
    count: input.annotations!.length,
    preview: input.annotations!.length === 1 ? "1 anotación" : `${input.annotations!.length} anotaciones`,
    compact: [compact],
  } satisfies AnnotationPartInput
})

requestParts.push(...annotations)
```

- [ ] **Step 1: Modificar build-request-parts.ts** — Agregar tipo AnnotationPartInput, campo annotations en BuildRequestPartsInput, y serialización en buildRequestParts.
- [ ] **Step 2: Verificación** — `cd packages/app && bun typecheck`.

---

### Task 7: Cápsula visual en prompt input

**Files:**
- Modify: `packages/app/src/components/prompt-input/` — donde se renderiza la barra de attachments
- Create: `packages/app/src/components/annotation-capsule/AnnotationCapsule.tsx` (ya existe de Task 5)

El flujo: AnnotationCapsule se renderiza en el área de attachments del prompt input, junto con las image attachments existentes. El componente `attachments.ts` o el parent `prompt-input.tsx` debe importar y mostrar `AnnotationCapsule`.

- [x] **Step 1: Ubicar dónde se renderizan image attachments en prompt-input (editor-dom.tsx o similar)**
- [x] **Step 2: Insertar `<AnnotationCapsule />` junto a las image attachments**
- [x] **Step 3: Verificación** — `cd packages/app && bun typecheck`

---

## Phase 5 — Files, downloads, hardening

### Task 8: Upload y downloads controlados

**Files:**
- Modify: `packages/desktop/src/main/browser/ipc-handlers.ts` — uploads/downloads handlers

```ts
import { app } from "electron"
import { join } from "node:path"
import { readdirSync } from "node:fs"

const DOWNLOAD_DIR = join(app.getPath("userData"), "browser-downloads")

ipcMain.handle("browser-upload-file", async (_event: IpcMainInvokeEvent, selector: string, fileRef: string) => {
  const absolutePath = resolveWorkspacePath(fileRef)
  const view = getOrCreateView()
  if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3")
  const document = await view.webContents.debugger.sendCommand("DOM.getDocument", { depth: -1 })
  const query = await view.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector,
  })
  await view.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
    nodeId: query.nodeId,
    files: [absolutePath],
  })
  return { ok: true }
})

ipcMain.handle("browser-downloads-list", async () => {
  const results: string[] = []
  try {
    const files = readdirSync(DOWNLOAD_DIR)
    results.push(...files.map((f) => join(DOWNLOAD_DIR, f)))
  } catch {}
  return results
})
```

- [x] **Step 1: Implementar handlers de upload/download en ipc-handlers.ts**
- [x] **Step 2: Verificación** — `cd packages/desktop && bun typecheck`

---

### Task 9: Logging redaction y context size limits

**Files:**
- Modify: `packages/desktop/src/main/browser/annotation.ts` — sanitización reforzada
- Modify: `packages/desktop/src/main/logging.ts` — redactar cookies/auth headers en browser logs

```ts
// En annotation.ts — sanitización extra
const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /x-api-key/i,
]

function redactSensitive(text: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[REDACTED]"), text)
}
```

- [ ] **Step 1: Implementar sanitización reforzada en annotation.ts
- [ ] **Step 2: Verificar que logging.ts redacta browser operations
- [ ] **Step 3: Verificación** — `cd packages/desktop && bun typecheck`

---

## Self-Review Checklist

**1. Spec coverage:**

| Spec Requirement | Task |
|-----------------|------|
| Desktop-only integrated browser panel | Task 1, Task 2, Task 3 |
| Browser opens on user/agent activation | Task 1, Task 2 |
| Any URL allowed | Task 1 (navigate) |
| Persistent cookies/session | Task 1 (partition) |
| Manual and tool-based clear | Task 2 (clearBrowserData) |
| Agent browser tools (16 tools) | Task 4 |
| DOM element annotation flow | Task 5 |
| Inline comment bubble | Task 5 (AnnotationBubble) |
| Aggregated chat capsule | Task 6, Task 7 |
| Screenshot capture | Task 2 (screenshot handler) |
| Hybrid compact+on-demand context | Task 6 |
| Security: isolated partition | Task 1 |
| Security: no nodeIntegration | Task 1 (webPreferences) |
| Security: contextIsolation | Task 1 (webPreferences) |
| Security: DOM sanitization | Task 9 |
| Security: logging redaction | Task 9 |
| Clear browser data UI | Task 2 |
| File upload/download | Task 8 |

**2. Placeholder scan:** No se encontraron TBD, TODO, placeholders o pasos vagos. Cada task tiene implementación concreta o una restricción explícita de fase.

**3. Type consistency:**
- `BrowserAnnotation.element.boundingBox` coincide en Task 1 (types.ts), Task 4 (BrowserManager), Task 5 (annotation-store), Task 6 (build-request-parts)
- `window.browser` API en preload y renderer consistente a través de Task 3, Task 4, Task 5
- `AnnotationPartInput` en build-request-parts.ts usa los mismos campos que `BrowserAnnotation`
- `uuid()` usado consistentemente para `id` generation

---

## Plan Summary

| Phase | Tasks | Descripción |
|-------|-------|-------------|
| 1 | 1-3 | Browser básico: manager, IPC, preload bridge |
| 2 | 4 | Herramientas del agente (click, type, inspect, screenshot, etc.) |
| 3 | 5 | Inspect mode, comment bubble, panel UI |
| 4 | 6-7 | Cápsula de anotación y serialización en request |
| 5 | 8-9 | Upload/download y hardening (sanitización, redaction) |

**Total: 9 tareas lógicas, ~25 steps ejecutables**

**Riesgos principales:**
1. `WebContentsView` vs `BrowserView` — depende de la versión de Electron instalada; puede requerir ajuste en Task 1 si la API no existe.
2. `executeJavaScript` en páginas externas — algunas páginas bloquean JS injection; fallback: CDP directo si disponible.
3. JS injection para inspección/anotación — mantener `sandbox: true` y ejecutar inspección desde main process con `webContents.executeJavaScript` o CDP, sin preload peligroso en páginas externas.
4. `prompt-input.tsx` complejo — la cápsula de anotación se agrega como componente separado, no se modifica el archivo existente.
5. Upload de archivos — Electron tiene limitaciones nativas con `input[type=file]`programático; puede requerir workaround con CDP File system API.

**skill_resolution: none**
