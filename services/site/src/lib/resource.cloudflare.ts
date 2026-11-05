// The Worker's bindings, in the shape SST's Resource had: `Resource.App.stage` and
// `Resource.NAME.value`. STAGE is a text binding in services/www/cloudflare.config.ts; the other
// names are Worker secrets set on the www Worker. Reading a name that isn't bound throws, as SST's
// Resource did, so callers keep their fallbacks. package.json `imports` picks this file for builds.
import { env } from "cloudflare:workers"
import type { Resources } from "./resource.node"

export { waitUntil } from "cloudflare:workers"

const bindings = env

export const Resource = new Proxy({} as Resources, {
  get(_target, name: string) {
    if (name === "App") return { stage: bindings.STAGE === "production" ? "production" : "dev" }
    const value = bindings[name]
    if (typeof value !== "string" || !value) throw new Error(`"${name}" is not bound to the www Worker`)
    return { value }
  },
})
