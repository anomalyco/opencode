import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`node ./node_modules/electron/install.js`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
await downloadCliToResources()
