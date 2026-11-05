const errorMessage = "@opentui/core/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

export function ensureRuntimePluginSupport() {
  throw new Error("@opentui/core/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.")
}

export function createRuntimePlugin() {
  throw new Error("@opentui/core/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.")
}

export function runtimeModuleIdForSpecifier() {
  throw new Error("@opentui/core/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.")
}

throw new Error(errorMessage)
