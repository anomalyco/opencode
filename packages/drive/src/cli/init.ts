import { initializeInstance } from "../instance/instance.js"
import { initializeManifest } from "../instance/registry.js"
import { configureLogFile, logSuccess } from "../log.js"

export async function init(name: string) {
  const manifest = await initializeManifest(name, process.cwd(), () => initializeInstance(name))
  configureLogFile(manifest.artifacts)
  logSuccess(`initialized ${name}`)
  console.log(manifest.artifacts)
}
