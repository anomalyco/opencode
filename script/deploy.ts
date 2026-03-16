import { join, resolve } from "node:path"
import { readdir, symlink, mkdir, unlink, lstat } from "node:fs/promises"
import { watch } from "node:fs"

const CWD = process.cwd()

// Configurable deploy target. Defaults to `.deploy` at repo root if not provided.
const DEPLOY_DIR = process.env.DEPLOY_DIR || resolve(CWD, ".deploy")
const DIST_DIR = resolve(CWD, "packages/opencode/dist")

async function syncLinks() {
  // Create deploy directory if it doesn't exist
  try {
    await mkdir(DEPLOY_DIR, { recursive: true })
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err
  }

  // Read all files from dist
  let files: string[] = []
  try {
    files = await readdir(DIST_DIR)
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.error(`Dist directory ${DIST_DIR} does not exist. Please build the project first.`)
      return
    }
    throw err
  }

  // Filter for built binaries (opencode-*)
  const binaries = files.filter(f => f.startsWith("opencode-") && (f.endsWith(".exe") || !f.includes(".")))

  for (const bin of binaries) {
    const source = join(DIST_DIR, bin)
    const target = join(DEPLOY_DIR, bin)

    // Remove existing link/file if it exists
    try {
      const stat = await lstat(target)
      if (stat) {
        await unlink(target)
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err
    }

    // Create the symlink
    try {
      await symlink(source, target, "file")
      console.log(`[LINKED] ${bin} -> ${target}`)
    } catch (err: any) {
      console.error(`Failed to link ${bin}:`, err.message)
      if (err.code === "EPERM" && process.platform === "win32") {
        console.error(`\nOn Windows, creating file symlinks requires running as Administrator or enabling Developer Mode.`)
      }
    }
  }
}

async function deploy() {
  console.log(`Setting up deployment links...`)
  console.log(`Source: ${DIST_DIR}`)
  console.log(`Target: ${DEPLOY_DIR}`)

  await syncLinks()

  console.log(`\nDeployment setup complete!`)
  console.log(`Watching for changes in ${DIST_DIR}...`)

  try {
    watch(DIST_DIR, async (eventType, filename) => {
      if (filename && filename.startsWith("opencode-")) {
        console.log(`Detected ${eventType} on ${filename}. Updating links...`)
        await syncLinks()
      }
    })
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.log("Waiting for dist/ directory to be created before watching...")
      // Polling fallback to wait for dir creation
      const timer = setInterval(() => {
        try {
          watch(DIST_DIR, async (eventType, filename) => {
            if (filename && filename.startsWith("opencode-")) {
              console.log(`Detected ${eventType} on ${filename}. Updating links...`)
              await syncLinks()
            }
          })
          clearInterval(timer)
          console.log(`Now watching ${DIST_DIR} for changes.`)
          syncLinks()
        } catch (e) {}
      }, 5000)
    } else {
      throw err
    }
  }
}

deploy().catch(err => {
  console.error("Deploy failed:", err)
  process.exit(1)
})
