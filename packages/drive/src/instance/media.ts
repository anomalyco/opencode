import { basename, join, resolve } from "node:path"
import { artifactDirectory } from "./instance.js"

export function mediaDirectory() {
  return resolve(process.env.OPENCODE_DRIVE_MEDIA_DIR ?? join(artifactDirectory(), "output"))
}

export const runMediaDirectory = (artifacts: string, generation: number) =>
  join(mediaDirectory(), basename(resolve(artifacts)), `generation-${generation}`)

export async function readInstanceMediaDirectory(artifacts: string, name: string) {
  const value: unknown = await Bun.file(join(artifacts, "drive", `${name}.json`)).json()
  if (typeof value !== "object" || value === null || !("media" in value) || typeof value.media !== "string")
    throw new Error(`drive instance "${name}" has no media directory`)
  return value.media
}
