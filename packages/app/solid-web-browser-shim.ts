/**
 * Preload shim for bun test:
 *
 * 1. Redirects solid-js and solid-js/web to their browser builds so that
 *    render() and other client-only APIs work in the happy-dom environment.
 *    Bun's test runner resolves exports via the "node" condition by default,
 *    which maps both packages to their server stubs.
 *
 * 2. Provides a global `React.createElement` shim so that .tsx files compiled
 *    by bun test (which uses React.createElement calls because tsconfig has
 *    jsx:"preserve") can render SolidJS components via createComponent.
 *
 * This file is listed in bunfig.toml [test] preload AFTER happydom.ts so the
 * DOM is already registered when this shim runs.
 */
import { mock } from "bun:test"

const solidPkg = "/code-projects/personal/opencode/node_modules/.bun/solid-js@1.9.10/node_modules/solid-js"

// Override solid-js with browser build — must use async factory so the mock
// is in place before the module graph for any test file resolves.
mock.module("solid-js", async () => {
  return await import(`${solidPkg}/dist/solid.js`)
})

mock.module("solid-js/web", async () => {
  return await import(`${solidPkg}/web/dist/web.js`)
})

// Provide a React.createElement shim that forwards component calls to
// SolidJS's createComponent so that Bun's React-style JSX output works
// within the solid-js reactive system.
//
// The test file has: render(() => <PwaUpdatePrompt />, container)
// Bun emits:         render(() => React.createElement(PwaUpdatePrompt, null), container)
//
// For native DOM elements (string tags), we create the DOM node directly
// since solid-js/web's browser render handles hydration separately.
const { createComponent } = await import(`${solidPkg}/dist/solid.js`)

globalThis.React = {
  createElement(
    tag: string | ((...args: unknown[]) => unknown),
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) {
    const merged: Record<string, unknown> = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children

    if (typeof tag === "function") {
      // SolidJS component — use createComponent so signals are tracked
      return createComponent(tag as () => unknown, merged)
    }

    // Native DOM element — create it directly (the solid-js template engine
    // handles reactive updates; for the simple banner we build it statically)
    const el = document.createElement(tag)
    for (const [key, val] of Object.entries(merged)) {
      if (key === "children") continue
      if (key === "className") el.className = val as string
      else if (key === "role") el.setAttribute("role", val as string)
      else if (key === "aria-label") el.setAttribute("aria-label", val as string)
      else if (key.startsWith("on") && typeof val === "function")
        el.addEventListener(key.slice(2).toLowerCase(), val as EventListener)
      else el.setAttribute(key, val as string)
    }
    // Append children
    const flatChildren = merged.children !== undefined ? [merged.children].flat(Infinity) : []
    for (const child of flatChildren) {
      if (child == null) continue
      if (typeof child === "string" || typeof child === "number")
        el.appendChild(document.createTextNode(String(child)))
      else if (child instanceof Node) el.appendChild(child)
    }
    return el
  },
}
