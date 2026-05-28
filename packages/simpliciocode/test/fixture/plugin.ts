import { mkdir } from "fs/promises"
import path from "path"

export async function markPluginDependenciesReady(dir: string) {
  await mkdir(path.join(dir, "node_modules"), { recursive: true })
  await Bun.write(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ packages: { "": { dependencies: { "@simpliciocode/plugin": "0.0.0" } } } }),
  )
}
