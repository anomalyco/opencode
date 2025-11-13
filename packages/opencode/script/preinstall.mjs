#!/usr/bin/env node

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const packagePath = path.join(dir, "package.json")

try {
  const content = fs.readFileSync(packagePath, "utf8")
  const data = JSON.parse(content)
  const current = data.bin && data.bin.opencode
  if (current !== "./bin/opencode") {
    data.bin = {
      opencode: "./bin/opencode",
    }
    fs.writeFileSync(packagePath, JSON.stringify(data, null, 2))
    console.log("Normalized opencode bin entry for cross-platform launcher")
  }
} catch (error) {
  console.error("Preinstall script error:", error.message)
}
