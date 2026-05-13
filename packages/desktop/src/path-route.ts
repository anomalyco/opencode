import { base64Encode } from "@opencode-ai/util/encode"

export type PathTarget = {
  __OPENCODE__?: {
    initialPath?: string | null
  }
  history: {
    replaceState(data: unknown, title: string, url?: string | URL | null): void
  }
}

export const pathRoute = (path: string) => `/${base64Encode(path)}/session`

export function routeInitialPath(target: PathTarget = window) {
  const path = target.__OPENCODE__?.initialPath
  if (!path) return
  target.__OPENCODE__!.initialPath = null
  target.history.replaceState(null, "", pathRoute(path))
  return path
}
