import { $ } from "bun"
import * as path from "node:path"

import { CLI_TARGET } from "./utils"

if (!CLI_TARGET) throw new Error("OPENCODE_CLI_TARGET not defined")

const BUNDLE_DIR = "dist"
const BUNDLES_OUT_DIR = path.join(process.cwd(), "dist/bundles")

await $`mkdir -p ${BUNDLES_OUT_DIR}`
await $`cp -r ${BUNDLE_DIR}/* ${BUNDLES_OUT_DIR}`
