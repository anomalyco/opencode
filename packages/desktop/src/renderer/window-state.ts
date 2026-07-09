export type DesktopWindowState = {
  id?: string
}

export function getDesktopWindowID(windowState: DesktopWindowState) {
  return windowState.id ?? "browser"
}

export async function readDesktopWindowState() {
  const api = window.api as typeof window.api & {
    getWindowID?: () => Promise<string>
  }
  return { id: await api.getWindowID?.() } satisfies DesktopWindowState
}
