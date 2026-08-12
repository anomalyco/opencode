import { resolveInstance } from "../instance/registry.js"

export async function dir(name?: string) {
  const manifest = await resolveInstance(name)
  console.log(manifest.artifacts)
}
