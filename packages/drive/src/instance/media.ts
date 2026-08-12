import { basename, join, resolve } from "node:path"
import { artifactDirectory } from "./instance.js"

export function mediaDirectory() {
  return resolve(
    process.env.OPENCODE_DRIVE_MEDIA_DIR ??
      join(artifactDirectory(), "output"),
  )
}

export const runMediaDirectory = (artifacts: string, generation: number) =>
  join(
    mediaDirectory(),
    basename(resolve(artifacts)),
    `generation-${generation}`,
  )
