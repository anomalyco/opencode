const errorMessage = "@opentui/solid/bun-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

function unavailable() {
  throw new Error(errorMessage)
}

export function ensureSolidTransformPlugin() {
  return unavailable()
}

export function resetSolidTransformPluginState() {
  return unavailable()
}

export function createSolidTransformPlugin() {
  return unavailable()
}

export default unavailable()

unavailable()
