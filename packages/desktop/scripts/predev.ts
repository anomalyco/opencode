import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.PENCODE_CHANNEL ?? "dev"}`

await $`cd ../pencode && bun script/build-node.ts`
await downloadCliToResources()
