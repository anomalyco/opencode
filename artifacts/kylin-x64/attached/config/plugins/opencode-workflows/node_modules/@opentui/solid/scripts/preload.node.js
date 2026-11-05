const errorMessage = "@opentui/solid/preload is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

function unavailable() {
  throw new Error(errorMessage)
}



unavailable()
