import path from "node:path"
import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

const opencodeDir = path.resolve(import.meta.dir, "../../opencode")
await $`bun ./script/build-node.ts`.cwd(opencodeDir)
await downloadCliToResources()
