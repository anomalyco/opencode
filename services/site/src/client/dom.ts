import type { clientStrings } from "./strings"

// Small helpers for the static pages' script (entry.ts) and their islands.

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
]
export const on = <K extends keyof DocumentEventMap>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
) => document.addEventListener(type, listener, options)
/** The element an event happened on, for `closest` (a text node's parent). */
export const target = (event: Event) =>
  (event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement) ?? document.body
export const site = $("[data-site]")!
export const html = document.documentElement
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

let strings: Record<string, string> | undefined

/** One of `clientStrings` with its {{params}} filled in. */
export function t(key: (typeof clientStrings)[number], params?: Record<string, string>) {
  strings ??= JSON.parse(site.dataset.strings ?? "{}") as Record<string, string>
  return (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => params?.[name] ?? raw)
}
