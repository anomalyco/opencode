// `@opentui/solid/jsx-runtime` as OpenTUI ships it, over the compatibility renderer: what Bun's JSX transform calls for
// a plugin with `@jsxImportSource @opentui/solid`, and so for every module of an installed package.
import { createComponent, createElement, spread } from "./render"

function normalizeProps(props: Record<string, unknown> | null | undefined) {
  if (!props) return {}
  if (!("key" in props)) return props
  const { key: _key, ...rest } = props
  return rest
}

export function jsx(type: unknown, props: Record<string, unknown> | null = {}) {
  const normalized = normalizeProps(props)
  if (typeof type === "function") return createComponent(type as (props: unknown) => unknown, normalized)
  const element = createElement(type as string)
  spread(element, normalized)
  return element
}

export const jsxs = jsx

export function jsxDEV(type: unknown, props: Record<string, unknown> | null = {}) {
  return jsx(type, props)
}

export function Fragment(props: { children?: unknown }) {
  return props.children ?? null
}
