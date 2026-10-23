import { Match, Schema } from "effect"
import type { Frame, Page } from "patchright-core"

const DemonstrationStep = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("click"),
    selector: Schema.String,
    role: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("fill"),
    selector: Schema.String,
    value: Schema.String,
    redacted: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("check"),
    selector: Schema.String,
    checked: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("select"),
    selector: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("navigation"),
    url: Schema.String,
  }),
])

export type DemonstrationStep = typeof DemonstrationStep.Type

export type DemonstrationResult = {
  readonly startedUrl: string
  readonly endedUrl: string
  readonly steps: readonly DemonstrationStep[]
  readonly code: string
}

type PageRecorderState = {
  active?: { readonly id: string; readonly startedUrl: string; readonly steps: DemonstrationStep[] }
}

const demonstrationBindingName = "__opencodeBrowserDemonstration__"
const pageRecorders = new WeakMap<Page, PageRecorderState>()
let nextRecorder = 0

export async function startDemonstrationRecorder(page: Page): Promise<{ readonly stop: () => Promise<DemonstrationResult> }> {
  const state = await recorderState(page)
  if (state.active) throw new Error("A human demonstration is already being recorded on this page")
  const id = `demo-${++nextRecorder}`
  const active = { id, startedUrl: page.url(), steps: [] as DemonstrationStep[] }
  state.active = active
  const pendingInstalls = new Set<Promise<void>>()
  const install = (frame: Frame): Promise<void> => {
    const pending = frame.evaluate(installDemonstrationListeners, { recorderId: id })
      .then(() => {}, () => {})
      .finally(() => pendingInstalls.delete(pending))
    pendingInstalls.add(pending)
    return pending
  }
  const onFrameNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) appendStep(active.steps, { kind: "navigation", url: frame.url() })
    void install(frame)
  }
  page.on("framenavigated", onFrameNavigated)
  await Promise.all(page.frames().map(install))
  let stopped = false
  return {
    stop: async () => {
      if (stopped) throw new Error("Human demonstration recording has already stopped")
      stopped = true
      page.off("framenavigated", onFrameNavigated)
      await Promise.all([...pendingInstalls])
      await Promise.all(page.frames().map((frame) => frame.evaluate(removeDemonstrationListeners, { recorderId: id }).catch(() => {})))
      if (state.active?.id === id) delete state.active
      const steps = [...active.steps]
      const endedUrl = page.isClosed() ? active.startedUrl : page.url()
      return {
        startedUrl: active.startedUrl,
        endedUrl,
        steps,
        code: formatDemonstrationCode({ startedUrl: active.startedUrl, steps }),
      }
    },
  }
}

export function formatDemonstrationCode(options: {
  readonly startedUrl: string
  readonly steps: readonly DemonstrationStep[]
}): string {
  const lines = [
    `// Recorded from ${options.startedUrl}`,
    ...options.steps.map((step) =>
      Match.value(step).pipe(
        Match.when({ kind: "navigation" }, ({ url }) => `// Navigated to ${url}`),
        Match.when({ kind: "click" }, ({ selector, role, name }) => {
          const description = role && name ? ` // ${role} ${JSON.stringify(name)}` : ""
          return `await page.locator(${JSON.stringify(selector)}).click()${description}`
        }),
        Match.when({ kind: "fill" }, ({ selector, value, redacted }) =>
          redacted
            ? `// Fill ${JSON.stringify(selector)} from an approved secret source.`
            : `await page.locator(${JSON.stringify(selector)}).fill(${JSON.stringify(value)})`),
        Match.when({ kind: "check" }, ({ selector, checked }) =>
          `await page.locator(${JSON.stringify(selector)}).${checked ? "check" : "uncheck"}()`),
        Match.when({ kind: "select" }, ({ selector, value }) =>
          `await page.locator(${JSON.stringify(selector)}).selectOption(${JSON.stringify(value)})`),
        Match.exhaustive,
      ),
    ),
    "return { url: page.url(), title: await page.title() }",
  ]
  return lines.join("\n")
}

async function recorderState(page: Page): Promise<PageRecorderState> {
  const existing = pageRecorders.get(page)
  if (existing) return existing
  const state: PageRecorderState = {}
  pageRecorders.set(page, state)
  await page.exposeBinding(demonstrationBindingName, (_source, value: unknown) => {
    const active = state.active
    if (!active || !isDemonstrationStep(value)) return
    appendStep(active.steps, value)
  })
  return state
}

function appendStep(steps: DemonstrationStep[], next: DemonstrationStep): void {
  const previous = steps.at(-1)
  if (next.kind === "fill" && previous?.kind === "fill" && previous.selector === next.selector) {
    steps[steps.length - 1] = next
    return
  }
  if (next.kind === "navigation" && previous?.kind === "navigation" && previous.url === next.url) return
  steps.push(next)
}

const isDemonstrationStep = Schema.is(DemonstrationStep)

function installDemonstrationListeners(options: { readonly recorderId: string }): void {
  type BrowserState = { readonly id: string; readonly cleanup: () => void }
  const browserWindow = window as Window & {
    __opencodeBrowserDemonstration__?: (step: DemonstrationStep) => unknown
    __opencodeBrowserDemonstrationListeners__?: BrowserState
  }
  browserWindow.__opencodeBrowserDemonstrationListeners__?.cleanup()
  const send = (step: DemonstrationStep) => {
    const binding = browserWindow.__opencodeBrowserDemonstration__
    if (binding instanceof Function) void Promise.resolve(binding(step)).catch(() => {})
  }
  const cssPath = (element: Element): string => {
    const id = element.getAttribute("id")
    if (id) return `#${CSS.escape(id)}`
    for (const attribute of ["data-testid", "data-test", "name", "aria-label"]) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const candidate = `[${attribute}="${CSS.escape(value)}"]`
      if (document.querySelectorAll(candidate).length === 1) return candidate
    }
    const parent = element.parentElement
    const tag = element.tagName.toLowerCase()
    if (!parent) return tag
    const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === element.tagName)
    return `${cssPath(parent)} > ${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
  }
  const nameFor = (element: Element): string | undefined => {
    const ariaLabel = element.getAttribute("aria-label")?.trim()
    if (ariaLabel) return ariaLabel
    const labelledBy = element.getAttribute("aria-labelledby")
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim()
      if (text) return text
    }
    const text = element.textContent?.replace(/\s+/g, " ").trim()
    return text ? text.slice(0, 120) : undefined
  }
  const roleFor = (element: Element): string | undefined => {
    const explicit = element.getAttribute("role")
    if (explicit) return explicit
    if (element instanceof HTMLButtonElement) return "button"
    if (element instanceof HTMLAnchorElement) return "link"
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox"
      if (element.type === "radio") return "radio"
      return "textbox"
    }
    if (element instanceof HTMLSelectElement) return "combobox"
    if (element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)) return "textbox"
    return undefined
  }
  const onClick = (event: Event) => {
    const target = event.composedPath().find((candidate) => candidate instanceof Element) as Element | undefined
    const actionable = target?.closest("button, a[href], summary, [role='button'], [role='link'], [role='tab'], [role='menuitem']")
    if (!actionable) return
    const role = roleFor(actionable)
    const name = nameFor(actionable)
    send({ kind: "click", selector: cssPath(actionable), ...(role === undefined ? {} : { role }), ...(name === undefined ? {} : { name }) })
  }
  const onInput = (event: Event) => {
    const element = event.target
    if (element instanceof HTMLInputElement) {
      if (["checkbox", "radio", "file", "button", "submit", "reset"].includes(element.type)) return
      send({ kind: "fill", selector: cssPath(element), value: element.type === "password" ? "" : element.value, ...(element.type === "password" ? { redacted: true } : {}) })
    } else if (element instanceof HTMLTextAreaElement) {
      send({ kind: "fill", selector: cssPath(element), value: element.value })
    } else if (element instanceof HTMLElement && element.isContentEditable) {
      send({ kind: "fill", selector: cssPath(element), value: element.innerText })
    }
  }
  const onChange = (event: Event) => {
    const element = event.target
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      send({ kind: "check", selector: cssPath(element), checked: element.checked })
    } else if (element instanceof HTMLSelectElement) {
      send({ kind: "select", selector: cssPath(element), value: element.value })
    } else {
      onInput(event)
    }
  }
  document.addEventListener("click", onClick, true)
  document.addEventListener("input", onInput, true)
  document.addEventListener("change", onChange, true)
  const cleanup = () => {
    document.removeEventListener("click", onClick, true)
    document.removeEventListener("input", onInput, true)
    document.removeEventListener("change", onChange, true)
    if (browserWindow.__opencodeBrowserDemonstrationListeners__?.id === options.recorderId) {
      delete browserWindow.__opencodeBrowserDemonstrationListeners__
    }
  }
  browserWindow.__opencodeBrowserDemonstrationListeners__ = { id: options.recorderId, cleanup }
}

function removeDemonstrationListeners(options: { readonly recorderId: string }): void {
  const browserWindow = window as Window & {
    __opencodeBrowserDemonstrationListeners__?: { readonly id: string; readonly cleanup: () => void }
  }
  if (browserWindow.__opencodeBrowserDemonstrationListeners__?.id === options.recorderId) {
    browserWindow.__opencodeBrowserDemonstrationListeners__.cleanup()
  }
}
