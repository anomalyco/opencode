import type { Platform } from "../../../../../app/src/context/platform"

const value: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
}

export function usePlatform() {
  return value
}
