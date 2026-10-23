import path from "node:path"
import { Effect, Predicate } from "effect"
import type { ElementHandle, Frame, Locator, Page } from "patchright-core"
import { ariaSnapshotWithoutTextControlValues } from "./aria-snapshot.ts"
import { runPlaywrightOperation } from "./execute.ts"
import { runtimeFailureKind } from "./runtime-diagnostics.ts"

type AriaSnapshotTarget = Locator | string

type AriaSnapshotOptions = {
  readonly timeout?: number
}

export type AriaSnapshotHelper = (target?: AriaSnapshotTarget, options?: AriaSnapshotOptions) => Promise<string>

type SnapshotOptions = {
  readonly within?: AriaSnapshotTarget
  readonly interactive?: boolean
  readonly compact?: boolean
  readonly diff?: boolean
  readonly delta?: boolean
  readonly find?: string | RegExp
  readonly context?: number
  readonly depth?: number
  readonly maxItems?: number
  readonly timeout?: number
}

export type SnapshotHelper = (options?: SnapshotOptions) => Promise<string>
export type SnapshotRefHelper = (id: string) => Locator

type SnapshotEntry = {
  readonly depth: number
  readonly baseDepth?: number
  readonly key?: string
  readonly parentKeys?: readonly string[]
  readonly role: string
  readonly name: string
  readonly identityName?: string
  readonly details?: string
  readonly selector?: string
  readonly selectorRole?: string
  readonly priority: number
}

export type SnapshotRefRegistry = {
  page?: Page
  url?: string
  selectors: Map<string, { readonly selector: string; readonly role: string; readonly name?: string }>
  previousSnapshot?: SnapshotBaseline
  nextRef?: number
  locatorScopes?: WeakMap<Locator, number>
  nextLocatorScope?: number
  removeNavigationListener?: () => void
}

type SnapshotRenderedEntry = {
  readonly prefix: string
  readonly details?: string
  readonly selector?: string
  readonly role?: string
  readonly identityName?: string
  readonly refId?: string
}

type SnapshotBaseline = {
  readonly page: Page
  readonly signature: string
  readonly entries: readonly SnapshotRenderedEntry[]
}

export type InputTarget = AriaSnapshotTarget

export const defaultAriaSnapshotTimeoutMs = 5_000
const defaultSnapshotTimeoutMs = 10_000
const snapshotRetryDelayMs = 25

export type InputField = {
  readonly selector: InputTarget
  readonly value: string
}

export type ScreenshotWithLabelsOptions = {
  readonly page?: Page
  readonly path?: string
  readonly registry?: SnapshotRefRegistry
}

export type ScreenshotWithLabelsResult = {
  readonly path?: string
  readonly image?: Buffer
  readonly size: number
  readonly labelCount: number
  readonly labels: readonly ScreenshotLabel[]
}

type ScreenshotLabel = {
  readonly ref: string
  readonly selector: string
  readonly role: string
  readonly text: string
  readonly context?: string
  readonly tagName: string
  readonly rect: ScreenshotLabelRect
}

type ScreenshotLabelRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export function createAriaSnapshotHelper(page: Pick<Page, "locator">): AriaSnapshotHelper {
  return async (target, options) => {
    const locator = target === undefined ? page.locator("body") : Predicate.isString(target) ? page.locator(target) : target
    return await ariaSnapshotWithoutTextControlValues(locator, {
      timeout: options?.timeout ?? defaultAriaSnapshotTimeoutMs,
    })
  }
}

/** Refs and diff baselines never survive the document they were captured from. */
export function invalidateSnapshotDocument(registry: SnapshotRefRegistry): void {
  registry.selectors.clear()
  delete registry.page
  delete registry.url
  delete registry.previousSnapshot
}

export function createSnapshotHelpers(page: Page, registry: SnapshotRefRegistry): {
  readonly snapshot: SnapshotHelper
  readonly ref: SnapshotRefHelper
} {
  const refRoots = new WeakMap<Locator, { readonly selector: string; readonly role: string; readonly name?: string }>()
  const snapshot: SnapshotHelper = async (options = {}) => {
    const within = options.within
    const withinSelector = Predicate.isString(within) ? within : undefined
    const withinLocator = within !== undefined && !Predicate.isString(within) ? within : undefined
    const refRoot = withinLocator ? refRoots.get(withinLocator) : undefined
    const locator = withinLocator && !refRoot ? withinLocator : undefined
    let locatorScope: number | undefined
    if (locator) {
      const scopes = registry.locatorScopes ??= new WeakMap()
      locatorScope = scopes.get(locator)
      if (locatorScope === undefined) {
        locatorScope = registry.nextLocatorScope ?? 1
        registry.nextLocatorScope = locatorScope + 1
        scopes.set(locator, locatorScope)
      }
    }
    const depth = Math.max(1, Math.min(16, Math.floor(options.depth ?? 10)))
    const maxItems = Math.max(1, Math.min(200, Math.floor(options.maxItems ?? 80)))
    const settings = {
      compact: options.compact ?? true,
      depth,
      interactive: options.interactive ?? false,
      maxCandidates: Math.max(1_000, maxItems * 20),
      maxItems,
      rootSelector: withinSelector ?? refRoot?.selector,
      rootRole: refRoot?.role,
      rootName: refRoot?.name,
    }
    const signature = JSON.stringify({
      compact: settings.compact,
      depth: settings.depth,
      interactive: settings.interactive,
      maxItems: settings.maxItems,
      scope: withinSelector !== undefined
        ? { kind: "selector", selector: withinSelector }
        : refRoot
        ? { kind: "ref", selector: refRoot.selector, role: refRoot.role, name: refRoot.name }
        : locator
        ? { kind: "locator", scope: locatorScope }
        : { kind: "page" },
    })
    const previousSnapshot = registry.previousSnapshot
    if (options.diff && options.delta) {
      throw new Error("snapshot() accepts either diff or delta, not both")
    }
    if (options.diff && !previousSnapshot) {
      throw new Error("snapshot({ diff: true }) requires a previous snapshot() baseline in this session")
    }
    if (options.diff && (previousSnapshot?.page !== page || previousSnapshot.signature !== signature)) {
      throw new Error("snapshot({ diff: true }) must use the same page and snapshot options as the previous snapshot")
    }

    registry.removeNavigationListener?.()
    registry.selectors.clear()
    delete registry.page
    delete registry.url
    let navigatedDuringCapture = false
    const onFrameNavigated = (frame: Frame) => {
      if (frame !== page.mainFrame()) return
      navigatedDuringCapture = true
      invalidateSnapshotDocument(registry)
    }
    const removeNavigationListener = () => page.off("framenavigated", onFrameNavigated)
    page.on("framenavigated", onFrameNavigated)
    registry.removeNavigationListener = removeNavigationListener

    const capture = (rootOrSettings: Element | typeof settings, locatorSettings?: typeof settings) => {
      type BrowserEntry = SnapshotEntry
      const settings = locatorSettings ?? rootOrSettings as typeof locatorSettings & typeof rootOrSettings

      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim()
      const truncate = (value: string, maxLength: number): string => {
        if (value.length <= maxLength) return value
        const prefix = value.slice(0, maxLength + 1)
        const boundary = prefix.lastIndexOf(" ")
        return `${prefix.slice(0, boundary >= Math.floor(maxLength * 0.6) ? boundary : maxLength).trimEnd()}...`
      }
      const quote = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const styleCache = new WeakMap<Element, CSSStyleDeclaration>()
      const styleOf = (element: Element): CSSStyleDeclaration => {
        let cached = styleCache.get(element)
        if (!cached) {
          cached = window.getComputedStyle(element)
          styleCache.set(element, cached)
        }
        return cached
      }
      const visibleCache = new WeakMap<Element, boolean>()
      const visibleAssociatedLabel = (element: Element): HTMLLabelElement | undefined => {
        if (!(element instanceof HTMLInputElement) || (element.type !== "radio" && element.type !== "checkbox")) {
          return undefined
        }
        return Array.from(element.labels ?? []).find((label) => isVisible(label))
      }
      const isVisible = (element: Element): boolean => {
        const cached = visibleCache.get(element)
        if (cached !== undefined) return cached
        const style = styleOf(element)
        let result = true
        if (style.display === "none" || style.visibility === "hidden") {
          result = false
        } else if (style.opacity === "0") {
          result = Boolean(visibleAssociatedLabel(element))
        } else if (style.display === "contents") {
          const children = [
            ...Array.from(element.children ?? []),
            ...Array.from(element.shadowRoot?.children ?? []),
          ]
          result = children.some(isVisible)
        } else {
          const rect = element.getBoundingClientRect()
          result = (rect.width >= 1 && rect.height >= 1) || Boolean(visibleAssociatedLabel(element))
        }
        visibleCache.set(element, result)
        return result
      }
      const explicitAriaName = (element: Element): string => {
        const ariaLabel = element.getAttribute("aria-label")
        if (ariaLabel) return normalize(ariaLabel)
        const labelledBy = element.getAttribute("aria-labelledby")
        if (labelledBy) {
          const rootNode = element.getRootNode() as Document | ShadowRoot
          const labelled = normalize(labelledBy.split(/\s+/).map((id) => (rootNode.getElementById?.(id) ?? document.getElementById(id))?.textContent ?? "").join(" "))
          if (labelled) return labelled
        }
        return ""
      }
      const titleName = (element: Element): string => normalize(element.getAttribute("title") ?? "")
      const labelledName = (element: Element): string => explicitAriaName(element) || titleName(element)
      const safeTextCache = new WeakMap<Element, string>()
      const safeText = (element: Element): string => {
        const cached = safeTextCache.get(element)
        if (cached !== undefined) return cached
        const parts: string[] = []
        const nearestBlock = (start: Element | null): Element => {
          let current = start
          while (current && current !== element && element.contains(current)) {
            const display = styleOf(current).display
            if (display && display !== "inline" && display !== "contents") return current
            current = current.parentElement
          }
          return element
        }
        let lastBlock: Element | undefined
        const rootStyle = styleOf(element)
        if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" || rootStyle.display === "none" || rootStyle.visibility === "hidden" || rootStyle.opacity === "0") {
          safeTextCache.set(element, "")
          return ""
        }
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
          acceptNode(node) {
            if (node instanceof Element) {
              if (node.matches("input, textarea, select, script, style, noscript, template")) {
                return NodeFilter.FILTER_REJECT
              }
              const style = styleOf(node)
              if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                return NodeFilter.FILTER_REJECT
              }
              if (node !== element && (node.hasAttribute("aria-label") || node.hasAttribute("aria-labelledby"))) {
                const ariaText = explicitAriaName(node)
                if (ariaText) {
                  parts.push(` ${ariaText} `)
                  lastBlock = undefined
                }
                return NodeFilter.FILTER_REJECT
              }
            }
            return NodeFilter.FILTER_ACCEPT
          },
        })
        let node = walker.nextNode()
        while (node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const block = nearestBlock(node.parentElement)
            if (lastBlock && lastBlock !== block) parts.push(" ")
            parts.push(node.textContent ?? "")
            lastBlock = block
          } else if (node instanceof HTMLImageElement) {
            const alt = node.getAttribute("alt")
            if (alt) parts.push(` ${alt} `)
            lastBlock = undefined
          } else if (typeof HTMLSlotElement !== "undefined" && node instanceof HTMLSlotElement) {
            for (const assigned of node.assignedNodes({ flatten: true })) {
              if (assigned.nodeType === Node.TEXT_NODE) {
                parts.push(assigned.textContent ?? "")
              } else if (assigned instanceof Element) {
                parts.push(safeText(assigned))
              }
            }
            lastBlock = undefined
          } else if (node instanceof Element && node.tagName === "BR") {
            parts.push(" ")
            lastBlock = undefined
          }
          node = walker.nextNode()
        }
        const result = normalize(parts.join(""))
        safeTextCache.set(element, result)
        return result
      }
      const authorAccessibleName = (element: Element): string => {
        const labelled = explicitAriaName(element)
        if (labelled) return labelled
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLButtonElement
        ) {
          const label = element.labels?.[0]
          if (label) {
            const labelText = safeText(label)
            if (labelText) return labelText
          }
        }
        if (element instanceof HTMLInputElement && (element.type === "button" || element.type === "submit" || element.type === "reset")) {
          const buttonValue = normalize(element.value || (element.type === "submit" ? "Submit" : element.type === "reset" ? "Reset" : ""))
          if (buttonValue) return buttonValue
        }
        const title = titleName(element)
        if (title) return title
        const placeholder = element.getAttribute("placeholder")
        if (placeholder) return normalize(placeholder)
        return ""
      }
      const accessibleNameCache = new WeakMap<Element, string>()
      const accessibleName = (element: Element): string => {
        const cached = accessibleNameCache.get(element)
        if (cached !== undefined) return cached
        let result = ""
        const labelled = explicitAriaName(element)
        if (labelled) {
          result = labelled
        } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          result = authorAccessibleName(element)
        } else {
          const alt = element.getAttribute("alt")
          const childAria = element.querySelector?.("[aria-label]")?.getAttribute("aria-label") || element.querySelector?.("svg title")?.textContent || ""
          result = normalize(alt || safeText(element) || titleName(element) || childAria)
        }
        accessibleNameCache.set(element, result)
        return result
      }
      const roleFor = (element: Element): string => {
        const explicit = element.getAttribute("role")
        if (explicit) return explicit
        if (/^H[1-6]$/.test(element.tagName)) return "heading"
        if (element instanceof HTMLAnchorElement || (element.tagName.toLowerCase() === "a" && element.hasAttribute("href"))) return "link"
        if (element instanceof HTMLButtonElement) return "button"
        if (element.tagName === "SUMMARY") return "summary"
        if (element instanceof HTMLTextAreaElement) return "textbox"
        if (element instanceof HTMLSelectElement) return element.hasAttribute("multiple") || element.size > 1 ? "listbox" : "combobox"
        if (element instanceof HTMLInputElement) {
          if (element.type === "checkbox") return "checkbox"
          if (element.type === "radio") return "radio"
          if (element.type === "number") return "spinbutton"
          if (element.type === "range") return "slider"
          if (["email", "search", "tel", "text", "url"].includes(element.type)) {
            const listId = element.getAttribute("list")?.trim().split(/\s+/)[0]
            const list = listId ? (element.getRootNode() as Document | ShadowRoot).getElementById(listId) : null
            if (list?.tagName === "DATALIST") return "combobox"
          }
          if (element.type === "search") return "searchbox"
          if (element.type === "button" || element.type === "submit" || element.type === "reset" || element.type === "file") return "button"
          return "textbox"
        }
        if (element instanceof HTMLDialogElement) return "dialog"
        if (element instanceof HTMLFieldSetElement || element.tagName === "DETAILS") return "group"
        if (element instanceof HTMLTableElement) return "table"
        if (element instanceof HTMLTableRowElement) return "row"
        if (element instanceof HTMLUListElement || element instanceof HTMLOListElement) return "list"
        if (element instanceof HTMLLIElement) return "listitem"
        if (element.tagName === "PRE" || element.tagName === "CODE") return "code"
        if (element.tagName === "NAV") return "navigation"
        return element.tagName.toLowerCase()
      }
      const structuralName = (element: Element, role: string): string => {
        const labelled = labelledName(element)
        if (labelled) return labelled
        if (element instanceof HTMLFieldSetElement) return normalize(element.querySelector(":scope > legend")?.textContent ?? "")
        if (element instanceof HTMLTableElement) return normalize(element.caption?.textContent ?? "")
        if (element instanceof HTMLDetailsElement) return normalize(element.querySelector(":scope > summary")?.textContent ?? "")
        if (role === "dialog" || role === "alertdialog" || role === "group") {
          return normalize(element.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")?.textContent ?? "")
        }
        if (role === "code") return normalize(element.textContent ?? "")
        if (role === "row") {
          const cells = Array.from(element.children).filter((child) => child.matches("th, td, [role='columnheader'], [role='rowheader'], [role='cell'], [role='gridcell']"))
          const values = cells.map((cell) => safeText(cell))
          if (values.length === 0) return safeText(element)
          const headerCells = cells.filter((cell) => cell.matches("th, [role='columnheader'], [role='rowheader']"))
          const table = element.closest("table, [role='table'], [role='grid']")
          const tableRows = table ? Array.from(table.querySelectorAll("tr, [role='row']")) : []
          const headerRow = tableRows.find((row) => {
            if (row === element) return false
            const rowCells = Array.from(row.children).filter((child) => child.matches("th, td, [role='columnheader'], [role='rowheader'], [role='cell'], [role='gridcell']"))
            return rowCells.length > 0 && (rowCells.every((cell) => cell.matches("th, [role='columnheader']")) || rowCells.some((cell) => cell.matches("th[scope='col'], [role='columnheader']")))
          })
          if (headerRow) {
            const headers = Array.from(headerRow.children)
              .filter((child) => child.matches("th, [role='columnheader']"))
              .map((cell) => safeText(cell))
            if (headers.length === values.length && headers.every(Boolean)) {
              return values.map((value, index) => `${headers[index]}: ${value}`).join(" | ")
            }
          }
          if (headerCells.length === cells.length) return values.join(" | ")
          if (headerCells.length > 0) {
            const headers = headerCells.map((cell) => safeText(cell)).filter(Boolean)
            const data = cells.filter((cell) => !headerCells.includes(cell)).map((cell) => safeText(cell)).filter(Boolean)
            return headers.length === 1 && data.length > 0 ? `${headers[0]}: ${data.join(" | ")}` : values.join(" | ")
          }
          return values.join(" | ")
        }
        if (role === "listitem") return safeText(element)
        return ""
      }
      let autoScopedMain = false
      const root = rootOrSettings instanceof Element
        ? rootOrSettings
        : (() => {
            if (settings.rootSelector) {
              const matches = document.querySelectorAll(settings.rootSelector)
              if (matches.length !== 1) {
                throw new Error(`snapshot within expects exactly one match for selector: ${settings.rootSelector}; got ${matches.length}`)
              }
              return matches[0] as Element
            }
            const fallbackRoot = (document.body ?? document.documentElement) as Element | null
            if (!fallbackRoot) return null
            const dialogs = Array.from(document.querySelectorAll("dialog, [role='dialog'], [role='alertdialog']")).filter(isVisible)
            const modals = dialogs.filter((dialog) => dialog.matches(":modal, [aria-modal='true']") || Boolean(dialog.closest?.("[data-focus-lock-disabled='false']")))
            if (modals.length === 1) return modals[0] as Element
            const isOpenListboxOrMenu = (menu: Element): boolean => {
              if (!isVisible(menu)) return false
              if (menu.getAttribute("aria-label") === "slider" || menu.getAttribute("aria-roledescription") === "carousel") return false
              const items = Array.from(menu.querySelectorAll("[role='option'], [role^='menuitem']")).filter(isVisible)
              return items.length > 0 && !items.some((item) => item.getAttribute("role") === "option" && item.querySelector?.("a[href], button"))
            }
            const portalMenus = Array.from(document.querySelectorAll("[role='listbox'], [role='menu']")).filter(isOpenListboxOrMenu)
            const mains = Array.from(document.querySelectorAll("main")).filter(isVisible)
            if (dialogs.length > 0 || (mains.length === 1 && portalMenus.some((menu) => !mains[0]!.contains?.(menu)))) {
              return fallbackRoot
            }
            if (mains.length === 1) {
              autoScopedMain = true
              return mains[0] as Element
            }
            return fallbackRoot
          })()
      if (!root) {
        return { entries: [], truncated: false }
      }
      if ((settings.rootRole && roleFor(root) !== settings.rootRole) || (settings.rootName && accessibleName(root) !== settings.rootName)) {
        throw new Error("Snapshot ref no longer identifies the captured element; call snapshot() again")
      }
      const detailsFor = (element: Element): string | undefined => {
        const details: string[] = []
        if (element instanceof HTMLInputElement) {
          if (element.type === "checkbox" || element.type === "radio") details.push(element.checked ? "checked" : "unchecked")
        }
        const ariaChecked = element.getAttribute("aria-checked")
        if ((ariaChecked === "true" || ariaChecked === "false" || ariaChecked === "mixed") && !(element instanceof HTMLInputElement)) {
          details.push(ariaChecked === "true" ? "checked" : ariaChecked === "false" ? "unchecked" : "checked=mixed")
        }
        if (element instanceof HTMLSelectElement) {
          const selected = element.selectedOptions[0]?.textContent
          if (selected) details.push(`selected="${quote(normalize(selected).slice(0, 80))}"`)
          details.push(`${element.options.length} options`)
        }
        if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
          if (element.disabled) details.push("disabled")
        }
        if (element.getAttribute("aria-disabled") === "true" && !details.includes("disabled")) {
          details.push("disabled")
        }
        const expanded = element.getAttribute("aria-expanded")
        if (expanded) details.push(`expanded=${expanded}`)
        if (element instanceof HTMLDetailsElement) details.push(`expanded=${element.open}`)
        if (element instanceof HTMLDialogElement) {
          details.push(`open=${element.open}`)
          const modal = element.getAttribute("aria-modal")
          if (modal) details.push(`modal=${modal}`)
        }
        if (element.tagName === "SUMMARY" && element.parentElement instanceof HTMLDetailsElement) details.push(`expanded=${element.parentElement.open}`)
        const selected = element.getAttribute("aria-selected")
        if (selected) details.push(`selected=${selected}`)
        const current = element.getAttribute("aria-current")
        if (current) details.push(`current=${current}`)
        if (element instanceof HTMLTableElement) details.push(`${element.rows.length} rows`)
        if (element instanceof HTMLUListElement || element instanceof HTMLOListElement) details.push(`${element.children.length} items`)
        if (element instanceof HTMLFieldSetElement) details.push(`${element.elements.length} controls`)
        return details.length ? details.join(" ") : undefined
      }
      const isShadowRoot = (node: unknown): node is ShadowRoot =>
        typeof ShadowRoot !== "undefined" && node instanceof ShadowRoot
      const parentElementOrHost = (node: Element | null): Element | null => {
        if (!node) return null
        if (node.parentElement) return node.parentElement
        const rootNode = node.getRootNode?.()
        return isShadowRoot(rootNode) ? rootNode.host : null
      }
      const closestDeep = (element: Element, selector: string): Element | null => {
        let current: Element | null = element
        while (current) {
          const match = current.closest?.(selector) ?? null
          if (match) return match
          const rootNode = current.getRootNode?.()
          current = isShadowRoot(rootNode) ? rootNode.host : null
        }
        return null
      }
      const querySelectorAllDeep = (scope: Element | Document | ShadowRoot, selector: string): Element[] => {
        if (!scope.children) {
          return Array.from(scope.querySelectorAll(selector))
        }
        const results: Element[] = []
        const visit = (node: Element | Document | ShadowRoot) => {
          for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
            if (child.matches(selector)) results.push(child)
            if (child.shadowRoot) visit(child.shadowRoot)
            if (child.firstElementChild) visit(child)
          }
        }
        if (scope instanceof Element && scope.shadowRoot) visit(scope.shadowRoot)
        visit(scope)
        return results
      }
      const localCssCache = new WeakMap<Element, string>()
      const localCssPath = (element: Element, scope: Document | ShadowRoot): string => {
        const cached = localCssCache.get(element)
        if (cached !== undefined) return cached
        const compute = (): string => {
          const id = element.getAttribute("id")
          if (id) {
            const candidate = `#${CSS.escape(id)}`
            if (scope.querySelectorAll(candidate).length === 1) return candidate
          }
          for (const attribute of ["data-testid", "data-test-id", "data-test", "name", "aria-label", "placeholder"]) {
            const value = element.getAttribute(attribute)
            if (value) {
              const candidate = `[${attribute}="${CSS.escape(value)}"]`
              if (scope.querySelectorAll(candidate).length === 1) return candidate
            }
          }
          const tag = element.tagName.toLowerCase()
          const role = element.getAttribute("role")
          const roleSuffix = role ? `[role="${quote(role)}"]` : ""
          let checkedClasses = 0
          for (const className of element.classList ?? []) {
            if (className.includes(":") || className.includes("[") || className.includes("/")) continue
            if (++checkedClasses > 4) break
            const candidate = `${tag}.${CSS.escape(className)}${roleSuffix}`
            if (scope.querySelectorAll(candidate).length === 1) return candidate
          }
          const parent = element.parentElement
          if (!parent) {
            if (isShadowRoot(scope)) {
              const siblings = Array.from(scope.children).filter((sibling) => sibling.tagName === element.tagName)
              return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
            }
            return tag
          }
          const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === element.tagName)
          return `${localCssPath(parent, scope)} > ${tag}:nth-of-type(${siblings.indexOf(element) + 1})`
        }
        const result = compute()
        localCssCache.set(element, result)
        return result
      }
      const cssPath = (element: Element): string => {
        const rootNode = element.getRootNode?.()
        if (isShadowRoot(rootNode)) {
          return `${cssPath(rootNode.host)} >> ${localCssPath(element, rootNode)}`
        }
        return localCssPath(element, document)
      }
      const rootHeadings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']")).map((heading) => {
        const candidate = /^H([1-6])$/.exec(heading.tagName)?.[1]
        return {
          heading,
          level: candidate ? Number(candidate) : Number(heading.getAttribute("aria-level") ?? 1),
        }
      })
      const headingDepthCache = new WeakMap<Element, number>()
      const headingDepth = (element: Element): number => {
        const cached = headingDepthCache.get(element)
        if (cached !== undefined) return cached
        const ownLevel = /^H([1-6])$/.exec(element.tagName)?.[1]
        if (ownLevel) {
          const depth = Number(ownLevel) - 1
          headingDepthCache.set(element, depth)
          return depth
        }
        let treeTarget = element
        while (isShadowRoot(treeTarget.getRootNode?.())) {
          treeTarget = (treeTarget.getRootNode() as ShadowRoot).host
        }
        let level = 0
        for (const { heading, level: candidateLevel } of rootHeadings) {
          if (heading === treeTarget || (heading.compareDocumentPosition(treeTarget) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue
          level = candidateLevel
        }
        headingDepthCache.set(element, level)
        return level
      }

      const structuralSelector = "fieldset, [role='group'], [role='radiogroup'], dialog, [role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu'], [role='tablist'], details, table, [role='table'], tr, [role='row'], ul, ol, [role='list'], li, [role='listitem'], pre"
      const interactiveSelector = [
        "a[href]", "button", "input", "textarea", "select", "summary",
        "[role='button']", "[role='link']", "[role='tab']",
        "[role='menuitem']", "[role='menuitemcheckbox']", "[role='menuitemradio']",
        "[role='option']", "[role='switch']", "[role='checkbox']", "[role='radio']",
        "[role='combobox']", "[role='searchbox']", "[role='textbox']",
        "[role='slider']", "[role='spinbutton']", "[role='treeitem']",
        "[contenteditable]",
      ].join(",")
      const structuralKeys = new WeakMap<Element, string>()
      let nextStructuralKey = 1
      const structuralKey = (element: Element): string => {
        const existing = structuralKeys.get(element)
        if (existing) return existing
        const key = `s${nextStructuralKey++}`
        structuralKeys.set(element, key)
        return key
      }
      const structuralParentKeys = (element: Element): string[] => {
        const keys: string[] = []
        let parent = parentElementOrHost(element)
        while (parent && parent !== root) {
          if (parent.matches(structuralSelector)) keys.push(structuralKey(parent))
          parent = parentElementOrHost(parent)
        }
        return keys
      }
      const primaryLinks = new WeakMap<Element, Element | null>()
      const isPrimaryLink = (element: Element): boolean => {
        if (
          element.closest?.("h1, h2, h3, h4, h5, h6, [role='heading']") ||
          element.querySelector?.("h1, h2, h3, h4, h5, h6, [role='heading']")
        ) {
          return true
        }
        const group = element.closest("article, li, tr, dt, [role='listitem'], [role='row']")
        if (!group || !root.contains(group)) return false
        if (!primaryLinks.has(group)) {
          const rawLinks = Array.from(group.querySelectorAll("a[href]"))
          if (group.matches("article, [role='article']") && rawLinks.length > 12) {
            primaryLinks.set(group, null)
            return false
          }
          const links = rawLinks.filter(isVisible)
          let primary: Element | null = null
          let primaryScore = -1
          for (const link of links) {
            const name = accessibleName(link)
            const headingBonus = link.closest("h1, h2, h3, h4, h5, h6, [role='heading']") ? 1_000 : 0
            const commentBonus = /\b\d+\s+comments?\b/i.test(name) ? 500 : 0
            const score = name.length + headingBonus + commentBonus
            if (score > primaryScore) {
              primary = link
              primaryScore = score
            }
          }
          primaryLinks.set(group, primary)
        }
        if (primaryLinks.get(group) !== element) return false
        if (group.matches("tr, [role='row']")) {
          const groupTextLength = safeText(group).length
          return groupTextLength > 0 && accessibleName(element).length / groupTextLength >= 0.15
        }
        return true
      }
      const isLayoutTable = (table: Element | null): boolean => {
        if (!table || !settings.compact) return false
        if (table.querySelector?.("table, [role='table']")) return true
        const hasHeaders = Boolean(
          labelledName(table) ||
          (table as HTMLTableElement).caption ||
          table.querySelector?.("th, [role='columnheader'], [role='rowheader']"),
        )
        if (hasHeaders) return false
        const rowCount = table instanceof HTMLTableElement
          ? table.rows.length
          : table.querySelectorAll("tr, [role='row']").length
        return rowCount <= 1 || rowCount >= 20
      }
      const isRedundantHeadingForLink = (element: Element): boolean => {
        if (!settings.compact || element === root) return false
        const parentInteractive = element.closest?.("a[href], button, [role='button'], [role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']")
        if (parentInteractive && (root.contains?.(parentInteractive) ?? true) && isVisible(parentInteractive)) {
          return true
        }
        const headingText = accessibleName(element)
        if (!headingText) return false
        const childLinks = Array.from(element.querySelectorAll?.("a[href]") ?? []).filter(isVisible)
        if (childLinks.length === 1) {
          const linkText = accessibleName(childLinks[0]!)
          if (linkText && (linkText === headingText || linkText.startsWith(headingText))) {
            return true
          }
        }
        const card = element.closest?.("article, [role='article']")
        if (card && (root.contains?.(card) ?? true)) {
          const rawCardLinks = Array.from(card.querySelectorAll("a[href]"))
          if (rawCardLinks.length <= 12 && rawCardLinks.filter(isVisible).some((link) => accessibleName(link) === headingText)) {
            return true
          }
        }
        return false
      }
      const seenCardLinks = new WeakMap<Element, Set<string>>()
      const isDuplicateCardLink = (element: Element, displayName: string): boolean => {
        if (!settings.compact || !displayName || !element.matches("a[href]")) return false
        const card = element.closest?.("article, [role='article'], li, [role='listitem'], tr, [role='row']")
        if (!card || !(root.contains?.(card) ?? true)) return false
        const href = element.getAttribute("href") ?? ""
        if (!href) return false
        let seen = seenCardLinks.get(card)
        if (!seen) {
          seen = new Set<string>()
          seenCardLinks.set(card, seen)
        }
        const key = `${href}\0${displayName}`
        if (seen.has(key)) return true
        seen.add(key)
        return false
      }
      const isRedundantListItem = (element: Element): boolean => {
        if (!settings.compact || element === root) return false
        if (element.querySelector?.("ul, ol, [role='list'], h1, h2, h3, h4, h5, h6, [role='heading']")) {
          return true
        }
        if (element.querySelector?.("p")) return false
        const controls = Array.from(element.querySelectorAll?.("a[href], button") ?? []).filter(isVisible)
        if (controls.length === 0) return false
        const itemLength = safeText(element).length
        return itemLength > 0 && controls.some((control) => accessibleName(control).length >= itemLength * 0.65)
      }
      const priorityFor = (options: { readonly role: string; readonly interactive: boolean; readonly primaryLink: boolean; readonly structuralEssential: boolean; readonly inActiveOverlay: boolean }): number => {
        if (options.role === "alert" || options.role === "status" || options.role === "navigation" || options.structuralEssential || options.inActiveOverlay) return -1
        if (options.role === "heading") return 0
        if (options.role === "link" && options.primaryLink) return 0
        if (options.interactive && (options.role !== "link" || options.primaryLink)) return 1
        if (options.role === "link") return 3
        return 2
      }

      type PendingEntry = BrowserEntry & { readonly interactiveElement?: Element }
      const entries: PendingEntry[] = []
      let truncated = false
      const add = (entry: PendingEntry): void => {
        if (entry.depth > settings.depth) return
        if (entries.length >= settings.maxCandidates) {
          truncated = true
          return
        }
        entries.push(entry)
      }
      const candidateSelector = [
        "h1", "h2", "h3", "h4", "h5", "h6", "[role='heading']",
        "nav", "[role='navigation']", "[role='alert']", "[role='status']", "p",
        structuralSelector,
        interactiveSelector,
      ].join(",")
      const headerSelector = "input, textarea, select, button, [role='searchbox'], [role='combobox'], [role='button'], a[href][aria-label]"
      const headerRoots = autoScopedMain && typeof document.querySelectorAll === "function"
        ? Array.from(document.querySelectorAll("header, [role='banner']")).filter((h) => isVisible(h) && !root.contains?.(h))
        : []
      const headerCandidateSet = new Set(
        headerRoots.flatMap((h) =>
          querySelectorAllDeep(h, headerSelector).filter((el) => !el.closest?.("nav, [role='navigation']")),
        ),
      )
      const candidates = [
        ...headerCandidateSet,
        ...(root.matches(candidateSelector) ? [root] : []),
        ...querySelectorAllDeep(root, candidateSelector),
      ]
      const collapsedNavigation = new Set<Element>()
      const nonCollapsibleNavigation = new WeakSet<Element>()
      let reservedLists = 0

      for (const element of candidates) {
        if (entries.length >= settings.maxCandidates) {
          truncated = true
          break
        }
        if (settings.compact && !headerCandidateSet.has(element)) {
          const navigation = closestDeep(element, "nav, [role='navigation'], aside, [role='complementary'], [data-slot='sidebar'], [data-sidebar='sidebar']")
          if (navigation && collapsedNavigation.has(navigation)) {
            continue
          }
          if (navigation && navigation !== root && !navigation.contains?.(root) && !nonCollapsibleNavigation.has(navigation)) {
            const isCollapsibleNav = isVisible(navigation) && (
              navigation.matches("nav, [role='navigation']") ||
              (querySelectorAllDeep(navigation, "a[href]").length >= 8 && !navigation.querySelector?.("h1, main, [role='main'], input, textarea, select"))
            )
            if (isCollapsibleNav) {
              collapsedNavigation.add(navigation)
              const count = querySelectorAllDeep(navigation, "a[href], button").length
              add({ depth: headingDepth(navigation), role: "navigation", name: truncate(labelledName(navigation), 100) || "Navigation", details: `${count} controls`, priority: 0 })
              continue
            }
            nonCollapsibleNavigation.add(navigation)
          }
        }
        if (!isVisible(element)) continue
        const role = roleFor(element)
        const isHeading = role === "heading"
        if (isHeading && isRedundantHeadingForLink(element)) continue
        if (
          role === "combobox" &&
          !(element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) &&
          element.querySelector?.("input, textarea, select")
        ) {
          continue
        }
        if (role === "option" && element.querySelector?.("a[href], button")) {
          continue
        }
        const isInteractive = element.matches(interactiveSelector)
        const isSafetyText = role === "alert" || role === "status"
        const isParagraph = element.matches("p")
        const isStructural = !isInteractive && element.matches(structuralSelector)
        if (isStructural) {
          if (role === "listbox" && (element.getAttribute("aria-label") === "slider" || element.getAttribute("aria-roledescription") === "carousel")) {
            continue
          }
          if (role === "listitem" && isRedundantListItem(element)) {
            continue
          }
          if (role === "table" && isLayoutTable(element)) {
            continue
          }
          if (role === "row" && (element.querySelector?.("table, [role='table']") || isLayoutTable(element.closest?.("table, [role='table']") ?? null))) {
            continue
          }
        }
        if (!isHeading && !isInteractive && !isSafetyText && !isStructural && (settings.interactive || !isParagraph)) continue
        if (settings.interactive && isParagraph && !isSafetyText) continue
        if (
          settings.compact &&
          isParagraph &&
          !isSafetyText &&
          element.parentElement?.matches("li, [role='listitem']") &&
          !isRedundantListItem(element.parentElement) &&
          safeText(element).length >= safeText(element.parentElement).length * 0.8
        ) {
          continue
        }
        const displayName = isStructural ? structuralName(element, role) : accessibleName(element)
        if (isInteractive && isDuplicateCardLink(element, displayName)) continue
        const nameFromAuthorOnly = role === "combobox" || role === "listbox" || role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "slider"
        const identityName = isInteractive
          ? (nameFromAuthorOnly ? authorAccessibleName(element) : displayName)
          : displayName
        const isDisabled = ((element as HTMLButtonElement).disabled === true) || element.getAttribute("aria-disabled") === "true"
        if (isInteractive && isDisabled && !displayName && !element.getAttribute("name")) continue
        const fallbackName = role === "group" ? "Group"
          : role === "dialog" || role === "alertdialog" ? "Dialog"
          : role === "listbox" ? "Listbox"
          : role === "menu" ? "Menu"
          : role === "table" ? "Table"
          : role === "list" ? "List"
          : role === "tablist" ? "Tab list"
          : isInteractive ? element.getAttribute("name") || element.getAttribute("data-testid") || element.getAttribute("data-test-id") || element.getAttribute("data-test") || role
          : ""
        const name = truncate(displayName || fallbackName, isParagraph || isSafetyText || isStructural ? 180 : 120)
        if (!name) continue
        const details = isHeading ? `level=${headingDepth(element) + 1}` : detailsFor(element)
        const primaryLink = (role === "link" && isPrimaryLink(element)) || headerCandidateSet.has(element)
        const baseDepth = headingDepth(element)
        const parentKeys = structuralParentKeys(element)
        const overlayAncestor = element.closest?.("dialog, [role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu']") ?? null
        const inActiveOverlay = Boolean(
          (isInteractive || role === "dialog" || role === "alertdialog" || role === "listbox" || role === "menu") &&
          overlayAncestor &&
          overlayAncestor.getAttribute("aria-label") !== "slider" &&
          overlayAncestor.getAttribute("aria-roledescription") !== "carousel",
        )
        const labelProxy = (() => {
          if (!isInteractive) return undefined
          const label = visibleAssociatedLabel(element)
          if (!label) return undefined
          const rect = element.getBoundingClientRect()
          if (rect.width < 1 || rect.height < 1) return label
          if (styleOf(element).opacity !== "0") return undefined
          const hit = document.elementFromPoint?.(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit === element ? undefined : label
        })()
        add({
          depth: baseDepth + parentKeys.length,
          baseDepth,
          ...(isStructural ? { key: structuralKey(element) } : {}),
          ...(parentKeys.length > 0 ? { parentKeys } : {}),
          role,
          name,
          ...(isInteractive && identityName && !labelProxy ? { identityName } : {}),
          ...(labelProxy ? { selectorRole: "label" } : {}),
          ...(isInteractive ? { interactiveElement: labelProxy ?? element } : {}),
          ...(details ? { details } : {}),
          priority: priorityFor({
            role: headerCandidateSet.has(element) ? "heading" : role,
            interactive: isInteractive,
            primaryLink,
            inActiveOverlay,
            structuralEssential: isStructural &&
              role !== "row" &&
              role !== "listitem" &&
              role !== "code" &&
              (role !== "group" || Boolean(displayName)) &&
              (role !== "list" || reservedLists++ < Math.max(1, Math.floor(settings.maxItems / 10))),
          }),
        })
      }
      const selected: BrowserEntry[] = entries
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => left.entry.priority - right.entry.priority || left.index - right.index)
        .slice(0, settings.maxItems)
        .sort((left, right) => left.index - right.index)
        .map(({ entry: { interactiveElement, ...rest } }) => ({
          ...rest,
          ...(interactiveElement ? { selector: cssPath(interactiveElement) } : {}),
        }))
      const needsSettle = Boolean(
        !settings.rootSelector &&
        typeof MutationObserver !== "undefined" &&
        document.body &&
        (
          Boolean(document.querySelector?.("[aria-busy='true'], .skeleton:not(.no-skeleton)")) ||
          (!selected.some((entry) => Boolean(entry.selector)) && typeof performance !== "undefined" && performance.now() < 2_500)
        ),
      )
      return {
        entries: selected,
        truncated: truncated || selected.length < entries.length,
        ...(needsSettle ? { needsSettle: true } : {}),
      }
    }
    const browserCapture = new Function(
      "rootOrSettings",
      "locatorSettings",
      `const __name = (target) => target
return (${capture.toString()})(rootOrSettings, locatorSettings)`,
    ) as typeof capture
    const timeoutMs = options.timeout ?? defaultSnapshotTimeoutMs
    let result: Awaited<ReturnType<typeof capture>>
    if (locator) {
      result = await locator.evaluate(browserCapture, settings, { timeout: timeoutMs })
    } else {
      const deadline = Date.now() + timeoutMs
      let captureAttempts = 0
      while (true) {
        navigatedDuringCapture = false
        try {
          result = await Effect.runPromise(runPlaywrightOperation({
            label: "Compact snapshot",
            timeoutMs: Math.max(100, deadline - Date.now()),
            run: () => page.evaluate(browserCapture, settings),
          }))
          if (navigatedDuringCapture && !options.diff && ++captureAttempts < 3 && Date.now() + snapshotRetryDelayMs < deadline) {
            await delay(snapshotRetryDelayMs)
            continue
          }
          if (result.needsSettle && !options.diff && captureAttempts === 0 && Date.now() + 120 < deadline) {
            captureAttempts++
            await page.evaluate(`new Promise((resolve) => {
              let quietTimer = window.setTimeout(done, 120);
              const maxTimer = window.setTimeout(done, 550);
              const observer = new MutationObserver(() => {
                window.clearTimeout(quietTimer);
                quietTimer = window.setTimeout(done, 55);
              });
              function done() {
                observer.disconnect();
                window.clearTimeout(quietTimer);
                window.clearTimeout(maxTimer);
                resolve();
              }
              if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              } else {
                done();
              }
            })`).catch(() => {})
            continue
          }
          break
        } catch (error) {
          if (withinSelector !== undefined && /not a valid selector|querySelectorAll/i.test(error instanceof Error ? error.message : String(error))) {
            result = await page.locator(withinSelector).evaluate(browserCapture, { ...settings, rootSelector: undefined }, { timeout: timeoutMs })
            break
          }
          const kind = runtimeFailureKind(error)
          if ((kind === "context-destroyed" || kind === "context-missing") && !options.diff && Date.now() + snapshotRetryDelayMs < deadline) {
            await delay(snapshotRetryDelayMs)
            continue
          }
          throw error
        }
      }
    }

    if (navigatedDuringCapture) {
      removeNavigationListener()
      delete registry.removeNavigationListener
      throw new Error("Page navigated while snapshot() was capturing; call snapshot() again")
    }
    registry.page = page
    registry.url = page.url()
    registry.selectors.clear()
    const structuralEntries = new Map(result.entries.flatMap((entry) => entry.key ? [[entry.key, entry] as const] : []))
    const resolvedDepths = new Map<SnapshotEntry, number>()
    const resolvedDepth = (entry: SnapshotEntry): number => {
      const cached = resolvedDepths.get(entry)
      if (cached !== undefined) return cached
      const parent = entry.parentKeys?.map((key) => structuralEntries.get(key)).find((candidate) => candidate !== undefined)
      const depth = parent ? resolvedDepth(parent) + 1 : entry.baseDepth ?? entry.depth
      resolvedDepths.set(entry, depth)
      return depth
    }
    const minimumDepth = result.entries.reduce((minimum, entry) => Math.min(minimum, resolvedDepth(entry)), Number.POSITIVE_INFINITY)
    const depthOffset = Number.isFinite(minimumDepth) ? minimumDepth : 0
    const rawEntries: SnapshotRenderedEntry[] = result.entries.map((entry) => {
      const name = entry.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      return {
        prefix: `${"  ".repeat(Math.max(0, resolvedDepth(entry) - depthOffset))}- ${entry.role} "${name}"`,
        ...(entry.details ? { details: entry.details } : {}),
        ...(entry.selector ? { selector: entry.selector, role: entry.selectorRole ?? entry.role } : {}),
        ...(entry.identityName ? { identityName: entry.identityName } : {}),
      }
    })
    if (result.truncated) rawEntries.push({ prefix: `- ... truncated after ${maxItems} items` })

    const compatiblePrevious = previousSnapshot?.page === page && previousSnapshot.signature === signature
      ? previousSnapshot
      : undefined
    let nextRef = registry.nextRef ?? 1
    const reusableRefs = new Map<string, string[]>()
    for (const entry of compatiblePrevious?.entries ?? []) {
      if (!entry.refId) continue
      const key = snapshotRefIdentity(entry)
      if (!key) continue
      const refs = reusableRefs.get(key) ?? []
      refs.push(entry.refId)
      reusableRefs.set(key, refs)
    }
    const entries = rawEntries.map((entry): SnapshotRenderedEntry => {
      const key = snapshotRefIdentity(entry)
      if (!key) return entry
      const reused = reusableRefs.get(key)?.shift()
      return { ...entry, refId: reused ?? `e${nextRef++}` }
    })
    registry.nextRef = nextRef

    const registerRef = (entry: SnapshotRenderedEntry, id: string): void => {
      if (!entry.selector || !entry.role) return
      registry.selectors.set(id, {
        selector: entry.selector,
        role: entry.role,
        ...(entry.identityName ? { name: entry.identityName } : {}),
      })
    }

    for (const entry of entries) {
      if (entry.refId) registerRef(entry, entry.refId)
    }

    const useDiff = options.diff === true || (options.delta === true && compatiblePrevious !== undefined)
    if (!useDiff) {
      const lines = entries.map((entry) => {
        return formatSnapshotLine(entry, entry.refId)
      })
      registry.previousSnapshot = { page, signature, entries }
      return options.find === undefined
        ? lines.join("\n")
        : findSnapshotLines(lines, options.find, options.context)
    }

    const operations = diffSnapshotEntries(compatiblePrevious?.entries ?? [], entries)
    const lines: string[] = []
    let additions = 0
    let removals = 0
    let unchanged = 0
    for (const operation of operations) {
      if (operation.kind === "unchanged") {
        unchanged++
        continue
      }
      if (operation.kind === "removed") {
        removals++
        lines.push(formatSnapshotDiffLine("-", operation.entry))
        continue
      }
      additions++
      lines.push(formatSnapshotDiffLine("+", operation.entry, operation.entry.refId))
    }
    lines.push(`${additions} ${additions === 1 ? "addition" : "additions"}, ${removals} ${removals === 1 ? "removal" : "removals"}, ${unchanged} unchanged`)
    registry.previousSnapshot = { page, signature, entries }
    return lines.join("\n")
  }

  const ref: SnapshotRefHelper = (id) => {
    if (!Predicate.isString(id) || !id.trim()) {
      throw new Error(`Unknown snapshot ref: ${String(id)}; call snapshot() to get current refs`)
    }
    const normalized = id.startsWith("@") ? id.slice(1) : id
    if (registry.page !== page || registry.url !== page.url()) {
      throw new Error("Snapshot refs are stale after a page change; call snapshot() again")
    }
    const snapshotRef = registry.selectors.get(normalized)
    if (!snapshotRef) {
      throw new Error(`Unknown snapshot ref: ${id}; call snapshot() to get current refs`)
    }
    const locator = page.locator(snapshotRef.selector)
    const role = snapshotRefAriaRole(snapshotRef.role)
    const resolved = role
      ? locator.and(page.getByRole(role, snapshotRef.name ? { name: snapshotRef.name, exact: true } : undefined))
      : locator
    refRoots.set(resolved, snapshotRef)
    return resolved
  }

  return { snapshot, ref }
}

function snapshotRefIdentity(entry: SnapshotRenderedEntry): string | undefined {
  if (!entry.selector || !entry.role) return undefined
  return JSON.stringify([entry.selector, entry.role, entry.identityName ?? null])
}

function findSnapshotLines(lines: readonly string[], query: string | RegExp, requestedContext: number | undefined): string {
  const context = Math.max(0, Math.min(10, Math.floor(requestedContext ?? 2)))
  const matches: number[] = []
  for (const [index, line] of lines.entries()) {
    const matched = Predicate.isString(query)
      ? line.toLowerCase().includes(query.toLowerCase())
      : (() => {
          query.lastIndex = 0
          return query.test(line)
        })()
    if (matched) matches.push(index)
  }
  if (matches.length === 0) {
    return `No snapshot lines matched ${Predicate.isString(query) ? JSON.stringify(query) : query.toString()}.`
  }
  const included = new Set<number>()
  for (const index of matches) {
    for (let candidate = Math.max(0, index - context); candidate <= Math.min(lines.length - 1, index + context); candidate++) {
      included.add(candidate)
    }
  }
  const output: string[] = []
  let previous = -2
  for (const index of [...included].sort((left, right) => left - right)) {
    if (index > previous + 1) output.push("...")
    output.push(lines[index]!)
    previous = index
  }
  return [`${matches.length} matching snapshot ${matches.length === 1 ? "line" : "lines"}:`, ...output].join("\n")
}

function formatSnapshotLine(entry: SnapshotRenderedEntry, id?: string): string {
  const suffix = [id ? `ref=${id}` : undefined, entry.details].filter(Boolean).join(" ")
  return `${entry.prefix}${suffix ? ` [${suffix}]` : ""}`
}

function formatSnapshotDiffLine(marker: "+" | "-", entry: SnapshotRenderedEntry, id?: string): string {
  const line = formatSnapshotLine(entry, id)
  const bullet = /^(\s*)- (.*)$/.exec(line)
  return bullet ? `${marker} ${bullet[1]}${bullet[2]}` : `${marker} ${line}`
}

function diffSnapshotEntries(
  previous: readonly SnapshotRenderedEntry[],
  current: readonly SnapshotRenderedEntry[],
): readonly (
  | { readonly kind: "unchanged"; readonly entry: SnapshotRenderedEntry }
  | { readonly kind: "removed"; readonly entry: SnapshotRenderedEntry }
  | { readonly kind: "added"; readonly entry: SnapshotRenderedEntry }
)[] {
  const previousLines = previous.map((entry) => formatSnapshotLine(entry))
  const currentLines = current.map((entry) => formatSnapshotLine(entry))
  const lengths = Array.from({ length: previous.length + 1 }, () => Array<number>(current.length + 1).fill(0))
  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex--) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex--) {
      lengths[previousIndex]![currentIndex] = previousLines[previousIndex] === currentLines[currentIndex]
        ? lengths[previousIndex + 1]![currentIndex + 1]! + 1
        : Math.max(lengths[previousIndex + 1]![currentIndex]!, lengths[previousIndex]![currentIndex + 1]!)
    }
  }

  const operations: Array<
    | { readonly kind: "unchanged"; readonly entry: SnapshotRenderedEntry }
    | { readonly kind: "removed"; readonly entry: SnapshotRenderedEntry }
    | { readonly kind: "added"; readonly entry: SnapshotRenderedEntry }
  > = []
  let previousIndex = 0
  let currentIndex = 0
  while (previousIndex < previous.length || currentIndex < current.length) {
    if (
      previousIndex < previous.length &&
      currentIndex < current.length &&
      previousLines[previousIndex] === currentLines[currentIndex]
    ) {
      operations.push({ kind: "unchanged", entry: current[currentIndex]! })
      previousIndex++
      currentIndex++
      continue
    }
    if (
      previousIndex < previous.length &&
      (currentIndex >= current.length || lengths[previousIndex + 1]![currentIndex]! >= lengths[previousIndex]![currentIndex + 1]!)
    ) {
      operations.push({ kind: "removed", entry: previous[previousIndex]! })
      previousIndex++
      continue
    }
    operations.push({ kind: "added", entry: current[currentIndex]! })
    currentIndex++
  }
  return operations
}

function snapshotRefAriaRole(role: string): Parameters<Page["getByRole"]>[0] | undefined {
  switch (role) {
    case "button":
    case "checkbox":
    case "combobox":
    case "link":
    case "listbox":
    case "menuitem":
    case "menuitemcheckbox":
    case "menuitemradio":
    case "option":
    case "radio":
    case "searchbox":
    case "slider":
    case "spinbutton":
    case "switch":
    case "tab":
    case "textbox":
    case "treeitem":
      return role
    default:
      return undefined
  }
}

export async function fillInput(options: { readonly page: Page; readonly target: InputTarget; readonly value: string }): Promise<void> {
  if (Predicate.isString(options.target)) {
    await fillInputs(options.page, [{ selector: options.target, value: options.value }])
    return
  }
  const locator = options.target
  await locator.evaluate((element, nextValue) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement
      const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
      if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, nextValue)
      } else {
        element.value = nextValue
      }
    } else if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = nextValue
    } else {
      throw new Error("fillInput expects an input, textarea, or contenteditable locator")
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: nextValue }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }, options.value, { timeout: 30_000 })
}

export async function fillInputs(page: Page, fields: ReadonlyArray<InputField>): Promise<void> {
  const locatorHandles: ElementHandle[] = []
  try {
    const resolvedFields: Array<{ readonly target: string | ElementHandle; readonly label: string; readonly value: string }> = []
    for (const field of fields) {
      if (Predicate.isString(field.selector)) {
        resolvedFields.push({ target: field.selector, label: `selector: ${field.selector}`, value: field.value })
        continue
      }
      const matches = await field.selector.elementHandles()
      locatorHandles.push(...matches)
      if (matches.length !== 1) {
        throw new Error(`fillInputs expects exactly one match for locator; got ${matches.length}`)
      }
      resolvedFields.push({ target: matches[0]!, label: "locator", value: field.value })
    }

    await page.evaluate((inputFields) => {
      return inputFields.map((field) => {
        let element: Node | undefined
        if (typeof field.target === "string") {
          const matches: Element[] = []
          const roots: Array<Document | ShadowRoot> = [document]
          for (let index = 0; index < roots.length; index += 1) {
            const root = roots[index]
            if (!root) continue
            matches.push(...root.querySelectorAll(field.target))
            for (const candidate of root.querySelectorAll("*")) {
              if (candidate.shadowRoot) roots.push(candidate.shadowRoot)
            }
          }
          if (matches.length !== 1) {
            if (matches.length === 0) {
              throw new Error(`fillInputs found no match for ${field.label} in the document or open shadow roots; closed shadow roots are unavailable. Try locator.fill() if Playwright can resolve the field.`)
            }
            throw new Error(`fillInputs expects exactly one match for ${field.label}; got ${matches.length}`)
          }
          element = matches[0]
        } else {
          element = field.target
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement
          const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set
          const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
          if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, field.value)
          } else {
            element.value = field.value
          }
        } else if (element instanceof HTMLElement && element.isContentEditable) {
          element.textContent = field.value
        } else {
          throw new Error(`fillInputs expects input, textarea, or contenteditable ${field.label}`)
        }
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: field.value }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
        return field.label
      })
    }, resolvedFields)
  } finally {
    await Promise.all(locatorHandles.map((handle) => handle.dispose().catch(() => {})))
  }
}

export async function screenshotWithLabels(options: ScreenshotWithLabelsOptions = {}): Promise<ScreenshotWithLabelsResult> {
  if (!options.page) {
    throw new Error("screenshotWithLabels requires a page")
  }
  if (options.path !== undefined && !path.isAbsolute(options.path)) {
    throw new Error("screenshotWithLabels requires an absolute path")
  }

  const page = options.page
  const labels = await showScreenshotLabels(page)
  if (options.registry) {
    const registry = options.registry
    registry.removeNavigationListener?.()
    registry.selectors.clear()
    registry.page = page
    registry.url = page.url()
    for (const label of labels) {
      registry.selectors.set(label.ref, {
        selector: label.selector,
        role: "screenshot-label",
      })
    }
    const onFrameNavigated = (frame: Frame) => {
      if (frame !== page.mainFrame()) return
      invalidateSnapshotDocument(registry)
    }
    const removeNavigationListener = () => page.off("framenavigated", onFrameNavigated)
    page.on("framenavigated", onFrameNavigated)
    registry.removeNavigationListener = removeNavigationListener
  }
  try {
    const screenshot = await page.screenshot(options.path ? { path: options.path } : {})
    return {
      ...(options.path ? { path: options.path } : { image: screenshot }),
      size: screenshot.byteLength,
      labelCount: labels.length,
      labels,
    }
  } finally {
    await hideScreenshotLabels(page)
  }
}

async function showScreenshotLabels(page: Page): Promise<readonly ScreenshotLabel[]> {
  return await page.evaluate(() => {
    type BrowserLabel = {
      readonly ref: string
      readonly selector: string
      readonly role: string
      readonly text: string
      readonly context?: string
      readonly tagName: string
      readonly rect: {
        readonly x: number
        readonly y: number
        readonly width: number
        readonly height: number
      }
    }

    const containerId = "__opencode_browser_screenshot_labels__"
    const markerClass = "__opencode_browser_screenshot_label__"
    const opencodeBrowserWindow = window as Window & { __opencodeBrowserScreenshotLabelsTimer?: number }
    if (opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer) {
      window.clearTimeout(opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer)
      delete opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer
    }
    document.getElementById(containerId)?.remove()

    const selectors = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "summary",
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="combobox"]',
      '[role="searchbox"]',
      '[role="textbox"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="treeitem"]',
      "[onclick]",
      "[contenteditable]",
    ]
    const selectorString = selectors.join(",")
    const isShadowRoot = (node: unknown): node is ShadowRoot =>
      typeof ShadowRoot !== "undefined" && node instanceof ShadowRoot
    const queryDeep = (scope: Element | Document | ShadowRoot): Element[] => {
      if (!scope.children) {
        return Array.from(scope.querySelectorAll(selectorString))
      }
      const results: Element[] = []
      const visit = (node: Element | Document | ShadowRoot) => {
        for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
          if (child.matches(selectorString)) results.push(child)
          if (child.shadowRoot) visit(child.shadowRoot)
          if (child.firstElementChild) visit(child)
        }
      }
      visit(scope)
      return results
    }
    const candidates = queryDeep(document)
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        if (rect.width < 4 || rect.height < 4) {
          return false
        }
        if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
          return false
        }
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0"
      })
      .slice(0, 80)

    const localSelectorForElement = (element: Element, scope: Document | ShadowRoot): string => {
      const id = element.getAttribute("id")
      if (id) {
        return `#${CSS.escape(id)}`
      }
      for (const attr of ["data-testid", "data-test-id", "data-test"]) {
        const val = element.getAttribute(attr)
        if (val) return `[${attr}="${CSS.escape(val)}"]`
      }
      const name = element.getAttribute("name")
      if (name) {
        return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
      }
      const parent = element.parentElement
      if (!parent) {
        if (isShadowRoot(scope)) {
          const siblings = Array.from(scope.children).filter((child) => child.tagName === element.tagName)
          return `${element.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(element) + 1})`
        }
        return element.tagName.toLowerCase()
      }
      const siblings = Array.from(parent.children).filter((child) => {
        return child.tagName === element.tagName
      })
      const index = siblings.indexOf(element) + 1
      return `${localSelectorForElement(parent, scope)} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`
    }

    const selectorForElement = (element: Element): string => {
      const rootNode = element.getRootNode?.()
      if (isShadowRoot(rootNode)) {
        return `${selectorForElement(rootNode.host)} >> ${localSelectorForElement(element, rootNode)}`
      }
      return localSelectorForElement(element, document)
    }

    const roleForElement = (element: Element): string => {
      const explicitRole = element.getAttribute("role")
      if (explicitRole) {
        return explicitRole
      }
      if (element instanceof HTMLAnchorElement) {
        return "link"
      }
      if (element instanceof HTMLButtonElement) {
        return "button"
      }
      if (element instanceof HTMLInputElement) {
        return element.type || "input"
      }
      if (element instanceof HTMLTextAreaElement) {
        return "textarea"
      }
      if (element instanceof HTMLSelectElement) {
        return "select"
      }
      if (element instanceof HTMLElement && element.isContentEditable) {
        return "contenteditable"
      }
      return element.getAttribute("onclick") ? "onclick" : element.tagName.toLowerCase()
    }

    const textForElement = (element: Element): string => {
      const ariaLabel = element.getAttribute("aria-label")
      const title = element.getAttribute("title")
      const placeholder = element.getAttribute("placeholder")
      const value = element instanceof HTMLInputElement ? element.value : ""
      return (ariaLabel || placeholder || value || title || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
    }

    const normalizeText = (value: string): string => {
      return value.replace(/\s+/g, " ").trim()
    }

    const trimContext = (value: string): string => {
      return normalizeText(value).slice(0, 60)
    }

    const accessibleTextForElement = (element: Element): string => {
      const ariaLabel = element.getAttribute("aria-label")
      if (ariaLabel) {
        return ariaLabel
      }
      const labelledBy = element.getAttribute("aria-labelledby")
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
        if (normalizeText(text)) {
          return text
        }
      }
      if (element instanceof HTMLFieldSetElement) {
        const legend = element.querySelector(":scope > legend")
        if (legend?.textContent) {
          return legend.textContent
        }
      }
      const heading = element.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6")
      if (heading?.textContent) {
        return heading.textContent
      }
      return element.textContent ?? ""
    }

    const nearestPrecedingHeading = (element: Element): string => {
      const elementRect = element.getBoundingClientRect()
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']"))
      let nearest: Element | undefined
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const heading of headings) {
        const rect = heading.getBoundingClientRect()
        if (rect.bottom > elementRect.top || rect.right < 0 || rect.left > window.innerWidth) {
          continue
        }
        const distance = elementRect.top - rect.bottom
        if (distance < nearestDistance) {
          nearest = heading
          nearestDistance = distance
        }
      }
      return nearest?.textContent ?? ""
    }

    const contextForElement = (element: Element, ownText: string): string | undefined => {
      const contextElement = element.closest("tr, [role='row'], li, [role='listitem'], fieldset, section, article, form, [aria-label], [aria-labelledby]")
      const rawContext = contextElement && contextElement !== element
        ? accessibleTextForElement(contextElement)
        : nearestPrecedingHeading(element)
      const context = trimContext(rawContext)
      const label = trimContext(ownText)
      if (!context || context.toLowerCase() === label.toLowerCase()) {
        return undefined
      }
      return context
    }

    const labels: BrowserLabel[] = candidates.map((element, index) => {
      const rect = element.getBoundingClientRect()
      const text = textForElement(element)
      const context = contextForElement(element, text)
      return {
        ref: `e${index + 1}`,
        selector: selectorForElement(element),
        role: roleForElement(element),
        text,
        ...(context ? { context } : {}),
        tagName: element.tagName.toLowerCase(),
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }
    })

    const container = document.createElement("div")
    container.id = containerId
    container.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"

    const style = document.createElement("style")
    style.textContent = `
      .${markerClass} {
        position: fixed;
        min-width: 18px;
        box-sizing: border-box;
        padding: 1px 4px;
        border: 1px solid #7c3aed;
        border-radius: 4px;
        background: #a78bfa;
        color: #111827;
        font-weight: 700;
        line-height: 16px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(17, 24, 39, 0.35);
      }
    `
    container.appendChild(style)

    const markers = labels.map((label) => {
      const marker = document.createElement("div")
      marker.className = markerClass
      marker.textContent = label.ref
      marker.style.left = `${Math.max(0, label.rect.x)}px`
      marker.style.top = `${Math.max(0, label.rect.y - 18)}px`
      return marker
    })
    container.append(...markers)

    document.documentElement.appendChild(container)
    opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer = window.setTimeout(() => {
      document.getElementById(containerId)?.remove()
      delete opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer
    }, 30_000)
    return labels
  })
}

async function hideScreenshotLabels(page: Page): Promise<void> {
  await page.evaluate(() => {
    const opencodeBrowserWindow = window as Window & { __opencodeBrowserScreenshotLabelsTimer?: number }
    if (opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer) {
      window.clearTimeout(opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer)
      delete opencodeBrowserWindow.__opencodeBrowserScreenshotLabelsTimer
    }
    document.getElementById("__opencode_browser_screenshot_labels__")?.remove()
  })
}
