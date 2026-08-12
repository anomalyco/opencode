import { listManifests, manifestPath } from "../instance/registry.js"

export async function list() {
  const instances = await listManifests()
  console.log(
    instances.map((instance) => `${instance.name}: ${manifestPath(instance.name)}`).join("\n"),
  )
}
