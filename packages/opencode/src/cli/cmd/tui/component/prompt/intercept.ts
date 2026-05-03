import type { ParsedKey, TextareaRenderable } from "@opentui/core"

export type InputInterceptHandler = (evt: ParsedKey, input: TextareaRenderable) => boolean | void
export type Unregister = () => void

const handlers: InputInterceptHandler[] = []

export function register(handler: InputInterceptHandler): Unregister {
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export function dispatch(evt: ParsedKey, input: TextareaRenderable): boolean {
  for (const handler of handlers) {
    if (handler(evt, input)) return true
  }
  return false
}