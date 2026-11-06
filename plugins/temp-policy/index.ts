import type { Plugin } from "@opencode/plugin"
import os from "node:os"
import path from "node:path"

const systemTemp = path.resolve(os.tmpdir())
const managedTemp = path.join(systemTemp, "opencode")

export function isGenericTempResource(resource: string) {
  const directory = path.resolve(resource.endsWith("/*") ? resource.slice(0, -2) : resource)
  return contains(systemTemp, directory) && !contains(managedTemp, directory)
}

export function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

const plugin: Plugin.Plugin = {
  id: "temp-policy",
  async setup(context) {
    await context.session.hook("context", (event) => {
      event.system.push({
        type: "text",
        text: [
          `Always use ${managedTemp} for temporary files and directories.`,
          `Do not use ${systemTemp} directly or any other path under it outside ${managedTemp}.`,
          "If a tool or command requires temporary storage, redirect it to the approved directory.",
        ].join(" "),
      })
    })

    await context.permission.hook("evaluate", (event) => {
      if (event.action !== "external_directory") return
      const blocked = event.resources.filter(isGenericTempResource)
      if (blocked.length === 0) return
      event.effect = "deny"
      event.message = `Generic OS temporary paths are disabled. Use ${managedTemp} instead; it is pre-created and approved for external access. Blocked: ${blocked.join(", ")}`
    })
  },
}

export default plugin
