// Startup marks, epoch ms. The entry module records them before any logger exists; the logging
// layer reports the early ones with "app starting" and the rest with "layers ready", so the startup
// benchmark can split the time before the renderer gets its IPC port into Electron's own
// initialisation, our entry, the main bundle and each layer.
export const marks: { entry: number } & Partial<
  Record<"ready" | "window" | "served" | "bundle" | "onboarding" | "logging" | "crash" | "storage" | "init" | "layers", number>
> = { entry: Date.now() }
