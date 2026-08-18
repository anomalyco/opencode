import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const mainBundleRoot = dirname(fileURLToPath(import.meta.url))
export const developmentResourcesRoot = join(mainBundleRoot, "../../resources")
export const preloadPath = join(mainBundleRoot, "../preload/index.js")
export const rendererRoot = join(mainBundleRoot, "../renderer")
