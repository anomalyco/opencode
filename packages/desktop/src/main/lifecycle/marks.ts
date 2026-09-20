// Startup marks, epoch ms. The entry module records them before any logger exists; the logging
// layer reports them with "app starting" so the startup benchmark can split the time before the
// first log line into Electron's own initialisation, our entry, and the main bundle.
export const marks: { entry: number; ready?: number; window?: number; bundle?: number } = { entry: Date.now() }
