import { extname, join, resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import type { Frontend } from "../client/protocol.js"

export async function renderScreenshot(frame: Frontend.CapturedFrame, directory: string, name?: string) {
  const filename = name ?? `screenshot-${crypto.randomUUID()}`
  if (!filename || filename.includes("/") || filename.includes("\\") || extname(filename))
    throw new Error("screenshot name must not contain a path or extension")
  const { renderFrame } = await import("../recording/render.js")
  const output = resolve(directory)
  await mkdir(output, { recursive: true })
  const path = join(output, `${filename}.png`)
  await Bun.write(path, renderFrame(frame))
  return path
}
