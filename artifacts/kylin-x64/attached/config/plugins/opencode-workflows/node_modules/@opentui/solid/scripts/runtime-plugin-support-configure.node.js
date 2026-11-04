const errorMessage = "@opentui/solid/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

function unavailable() {
  throw new Error(errorMessage)
}

export function ensureRuntimePluginSupport() {
  return unavailable()
}

unavailable()
