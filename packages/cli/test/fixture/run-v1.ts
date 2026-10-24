import path from "node:path"
import { runV1Bridge } from "../../src/run/v1"

const preload = path.join(import.meta.dir, "../../../tui/node_modules/@opentui/solid/scripts/preload.js")
await runV1Bridge({
  message: ["Create marker.txt containing hi"],
  format: "json",
  file: [],
  model: "mock/m",
  standaloneCommand: [
    process.execPath,
    "--conditions=browser",
    `--preload=${preload}`,
    path.join(import.meta.dir, "../../src/index.ts"),
    "serve",
  ],
})
