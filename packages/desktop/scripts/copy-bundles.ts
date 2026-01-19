import { $ } from "bun"
import * as path from "node:path"

import { RUST_TARGET } from "./utils"

if (!RUST_TARGET) throw new Error("RUST_TARGET not defined")

const BUNDLE_DIR = `src-tauri/target/${RUST_TARGET}/release/bundle`
const BUNDLES_OUT_DIR = path.join(process.cwd(), `src-tauri/target/bundles`)

await $`mkdir -p ${BUNDLES_OUT_DIR}`
await $`cp -r ${BUNDLE_DIR}/*/OpenCode* ${BUNDLES_OUT_DIR}`
