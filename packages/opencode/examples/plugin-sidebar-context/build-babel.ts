#!/usr/bin/env bun

import { transformAsync } from "@babel/core"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load babel presets from node_modules
const solidPreset = require(path.join(__dirname, "../../node_modules/babel-preset-solid"))
const tsPreset = require(path.join(__dirname, "../../node_modules/@babel/preset-typescript"))

console.log("Building plugin with Babel + SolidJS preset...")

const inputFile = path.join(__dirname, "index.tsx")
const outputFile = path.join(__dirname, "dist/index.js")

// Ensure dist directory exists
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true })

// Read the file content
const fileContent = await fs.promises.readFile(inputFile, "utf-8")

// Transform with Babel using babel-preset-solid (same config as @opentui/solid uses)
const result = await transformAsync(fileContent, {
  filename: inputFile,
  presets: [
    [
      solidPreset,
      {
        moduleName: "@opentui/solid",
        generate: "universal",
      },
    ],
    [tsPreset],
  ],
})

if (!result || typeof result !== "object" || !("code" in result) || !result.code) {
  console.error("Build failed: no code generated")
  process.exit(1)
}

// Write output
fs.writeFileSync(outputFile, result.code as string, "utf-8")

console.log("✓ Plugin built successfully to", outputFile)
