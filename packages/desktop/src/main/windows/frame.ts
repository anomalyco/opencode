// Shared by the early window and later windows so startup uses the same native chrome.
export function windowFrame(platform: NodeJS.Platform, mode: "light" | "dark") {
  if (platform === "darwin") {
    return { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 14, y: 14 } }
  }
  if (platform === "win32" || platform === "linux") {
    return { frame: false, titleBarStyle: "hidden" as const, titleBarOverlay: titlebarOverlay(mode) }
  }
  return {}
}

export function titlebarOverlay(mode: "light" | "dark", zoom = 1) {
  // Match the renderer's 36px titlebar plus its former 8px content inset.
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(44, Math.round(44 * zoom)),
  }
}
