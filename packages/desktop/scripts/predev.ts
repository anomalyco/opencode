import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`bun script/build-node.ts --server-only --bundle-only --skip-install`.cwd("../cli")
