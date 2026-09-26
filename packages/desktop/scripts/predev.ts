import { $ } from "bun"
import { buildWindowsProcessHelper, downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
await buildWindowsProcessHelper()
await downloadCliToResources()
