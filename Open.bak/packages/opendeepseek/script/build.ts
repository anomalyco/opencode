import path from "path"
import fs from "fs"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
const Script = { version: pkg.version || "0.0.0", channel: "dev" }

const targets = [{ os: process.platform, arch: process.arch }]

if (fs.existsSync("dist")) { fs.rmSync("dist", { recursive: true, force: true }) }

for (const item of targets) {
  const osName = item.os === "win32" ? "windows" : item.os
  const name = `opendeepseek-${osName}-${item.arch}`
  console.log(`[BUILD] Target: ${name}`)

  const binDir = path.join("dist", name, "bin")
  fs.mkdirSync(binDir, { recursive: true })

  const outfile = path.join(binDir, "opendeepseek" + (item.os === "win32" ? ".exe" : ""))

  try {
    console.log(`[BUILD] Compiling with Solid JSX support...`)

    // Use solid-js as JSX import source (not @opentui/solid which only has types)
    const cmd = `bun build --compile ./src/index.ts --outfile "${outfile}" --jsx-import-source solid-js --define OPENDEEPSEEK_VERSION="${Script.version}" --define OPENDEEPSEEK_CHANNEL="${Script.channel}" --external bun-pty --external fsevents`

    console.log(`[BUILD] Running compilation...`)
    execSync(cmd, {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" }
    })

    console.log(`[BUILD] ✓ Success: ${outfile}`)
  } catch (err: any) {
    console.error(`[BUILD] ✗ Fatal Error: ${err?.message || err}`)
    process.exit(1)
  }
}
