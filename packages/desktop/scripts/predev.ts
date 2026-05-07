import path from "node:path"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { $ } from "bun"

const desktopDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(desktopDir, "node_modules", "electron")
if (!existsSync(path.join(electronDir, "path.txt"))) {
  console.error("Electron OS binary missing; running electron postinstall (node install.js)...")
  const proc = Bun.spawn(["node", "install.js"], {
    cwd: electronDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) {
    console.error("electron install.js exited with code", code)
    process.exit(code ?? 1)
  }
}

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
