import { rm } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { artifactDirectory } from "../instance/instance.js"
import { requestStop } from "../instance/control.js"
import { manifestPath, resolveInstance } from "../instance/registry.js"
import { configureLogFile, logSuccess } from "../log.js"

export async function stop(name?: string) {
  const manifest = await resolveInstance(name)
  configureLogFile(manifest.artifacts)
  const result = await requestStop(manifest.control, (percent) => {
    logSuccess(`Rendering video: ${percent}%`)
  })
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const current: unknown = await Bun.file(manifestPath(manifest.name))
      .json()
      .catch(() => undefined)
    if (
      typeof current !== "object" ||
      current === null ||
      !("pid" in current) ||
      current.pid !== manifest.pid
    ) {
      for (const screenshot of result.screenshots) console.log(screenshot)
      if (result.recording) {
        logSuccess(`Video successfully created: ${result.recording}`)
      } else if (result.screenshots.length === 0) {
        console.log("success")
      }
      await pruneArtifacts(manifest.artifacts)
      return
    }
    await Bun.sleep(25)
  }
  throw new Error(`timed out stopping drive instance "${manifest.name}"`)
}

async function pruneArtifacts(artifacts: string) {
  const directory = resolve(artifacts)
  if (dirname(directory) !== artifactDirectory() || !/^run-[^/\\]+$/.test(basename(directory))) return
  await rm(directory, { recursive: true, force: true })
}
