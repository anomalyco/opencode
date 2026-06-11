import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "prod"}`

await $`cd ../opencode && bun script/build-node.ts`
