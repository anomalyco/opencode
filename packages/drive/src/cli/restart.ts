import { request } from "../instance/control.js"
import { resolveInstance } from "../instance/registry.js"
import { configureLogFile, logSuccess } from "../log.js"

export async function restart(name?: string) {
  const manifest = await resolveInstance(name)
  configureLogFile(manifest.artifacts)
  logSuccess(`restarting ${manifest.name}`)
  const recording = await request(manifest.control, "restart")
  console.log(recording ?? "success")
}
