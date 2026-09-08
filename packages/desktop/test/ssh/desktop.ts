import path from "node:path"
import { writeFile } from "node:fs/promises"
import { loadConfigFromFile, MainConfigFactory } from "electron-vite"
import { build } from "vite"

// Electron's browser process needs a display even when askpass creates no windows.
export const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY

export async function buildDesktop(directory: string) {
  // Use Node for Vite, as the desktop build does. Bun treats packages such as ws
  // as built-ins and would incorrectly leave them external in the Electron bundle.
  const child = Bun.spawn(["node", import.meta.filename, directory], { stdout: "ignore", stderr: "pipe" })
  const stderr = await new Response(child.stderr).text()
  if ((await child.exited) !== 0) throw new Error(stderr)
  const electron: unknown = (await import("electron")).default
  if (typeof electron !== "string") throw new Error("Electron binary path is unavailable")
  return [electron, directory] as const
}

if (process.argv[1] === import.meta.filename) {
  const directory = process.argv[2]
  if (!directory) throw new Error("Missing desktop fixture directory")
  const root = path.resolve(import.meta.dirname, "../..")
  const result = await loadConfigFromFile(
    { command: "build", mode: "production" },
    path.join(root, "electron.vite.config.ts"),
  )
  if (!result.config.main) throw new Error("Missing main-process build configuration")
  const config = await new MainConfigFactory(
    result.config.main,
    { configFile: false, mode: "production" },
    { root },
  ).build()
  config.build = { ...config.build, outDir: directory }
  config.logLevel = "silent"
  await build(config)
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module", main: "index.js" }))
}
