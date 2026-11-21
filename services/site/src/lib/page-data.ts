import { createAsync } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"

/** What the static renderer (src/static/render.tsx) keeps on the request while it renders a page. */
export type StaticPass = { collect: boolean; pending: Promise<unknown>[]; values: unknown[]; next: number }

/**
 * A page's data that loads asynchronously (the status bars, GitHub's releases). The hydrated app
 * reads it with createAsync. A page the Worker renders as plain HTML (src/static/render.tsx) renders in
 * one synchronous pass, which can't wait for it, so the renderer renders the page once to collect what
 * it asks for, waits for all of it, and renders again with each answer in place, in the order it was
 * asked for.
 */
export function pageData<T>(load: () => Promise<T>) {
  const pass = import.meta.env.SSR ? (getRequestEvent()?.locals.staticPass as StaticPass | undefined) : undefined
  if (!pass) return createAsync(load)
  const index = pass.next++
  if (pass.collect) pass.pending[index] = load()
  // Each render must ask in the same order: a pageData() only one of them reaches would shift the rest.
  else if (index >= pass.values.length)
    throw new Error("pageData: the second render asked for more data than the first")
  const value = pass.values[index] as T | undefined
  return () => value
}
