/**
 * Setup tiktoken WASM file path for Bun compiled binaries
 * This must be imported before any tiktoken usage
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Log } from "./log"

const log = Log.create({ service: "tiktoken-setup" })

// Setup WASM file location for tiktoken in compiled binary
function setupTiktokenWasm() {
  try {
    // Get the directory where the binary is located
    const binaryDir = path.dirname(process.execPath)
    const wasmSource = path.join(binaryDir, "tiktoken_bg.wasm")

    // Check if we're in a compiled binary and the WASM file exists next to it
    if (!fs.existsSync(wasmSource)) {
      return // Not in a compiled binary or WASM not found
    }

    // Tiktoken looks in __dirname of its module file
    // In a compiled Bun binary, we need to patch the require/import resolution
    // The tiktoken module will look for the WASM relative to its own location

    // Monkey-patch the fs.readFileSync to intercept tiktoken's WASM load
    const originalReadFileSync = fs.readFileSync
    ;(fs as any).readFileSync = function (filepath: any, options?: any) {
      // If tiktoken is trying to load its WASM file, redirect to our location
      if (typeof filepath === "string" && filepath.includes("tiktoken_bg.wasm")) {
        // Redirect to our WASM file location
        const redirected = wasmSource
        // Debug logging (can be removed after verification)
        if (process.env.DEBUG_TIKTOKEN) {
          log.debug(`Redirecting WASM load from ${filepath} to ${redirected}`)
        }
        filepath = redirected
      }
      return originalReadFileSync.call(fs, filepath, options)
    }

    // Also check if the WASM file is readable
    const wasmBytes = fs.readFileSync(wasmSource)
    // Uncomment for debugging:
    // console.log(`[tiktoken-setup] Successfully loaded WASM file (${wasmBytes.length} bytes) from ${wasmSource}`)
  } catch (error) {
    // Silently fail - might not be needed in dev environment
    log.warn("Could not setup tiktoken WASM", { error })
  }
}

// Run setup immediately when this module loads
setupTiktokenWasm()

export function setupTiktoken() {
  // This function can be called explicitly to ensure setup runs first
  // The actual setup happens at module load time above
}
