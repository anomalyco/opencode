// The Worker's bindings, in the shape SST's Resource had: `Resource.App.stage` and
// `Resource.NAME.value`. STAGE is a text binding in cloudflare.config.ts; the other names are
// Worker secrets set on the site Worker. Reading a name that isn't bound throws, as SST's Resource
// did, so callers keep their fallbacks. package.json `imports` picks this file for builds.
import { env } from "cloudflare:workers"
import type { AssetsBinding, Resources } from "./resource.node"

export { waitUntil } from "cloudflare:workers"

const bindings = env

export const Resource = new Proxy({} as Resources, {
  get(_target, name: string) {
    if (name === "App") return { stage: bindings.STAGE === "production" ? "production" : "dev" }
    const value = bindings[name]
    if (typeof value !== "string" || !value) throw new Error(`"${name}" is not bound to the site Worker`)
    return { value }
  },
})

/**
 * The Worker's static assets. Code that needs a built file reads it here: a fetch to the site's
 * own URL would not reach this Worker again (Cloudflare sends a Worker's subrequests to its own
 * routes past it).
 */
export function assets() {
  return bindings.ASSETS as AssetsBinding
}
